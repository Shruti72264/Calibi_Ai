"""
Automated-response engine - staged, allow-listed, audited, reversible.

Three modes, chosen by `SOC_RESPONSE_MODE`:

* **recommend** (default) - classify the event and *propose* an action. Nothing
  is executed. The dashboard's button produces an audit entry that says
  `recommended`, never "blocked".
* **dry_run** - full validation plus the exact command that *would* run. Still
  nothing is executed. Use this to prove the logic without touching a host.
* **enforce** - executes a single, precisely-scoped command on the **local
  host only**, and only when *all* of these hold:
      1. target IP is present in `SOC_RESPONSE_ALLOWLIST` (never arbitrary input)
      2. `confirm=true` and a non-empty `authorization` statement are supplied
      3. the action count is under `SOC_RESPONSE_MAX_ACTIONS_PER_HOUR`
      4. the action targets the local firewall (iptables/ufw), never a router,
         switch, ASA or remote device

Hard limits, by design:
  * No shell. `subprocess` is invoked with an **argv list** and `shell=False`.
  * No user string is ever interpolated into a command - only validated IPs.
  * No endpoint accepts a command, a filename or a path from the caller.
  * Every attempt - including refusals - is written to the audit log with its
    reason and its rollback command.
"""

from __future__ import annotations

import ipaddress
import logging
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone

from ..audit import AuditStore
from ..settings import Settings, get_settings

log = logging.getLogger("sentinel.response")

VALID_MODES = {"recommend", "dry_run", "enforce"}
CHAIN = "SENTINEL_SOC"  # our own chain: never touch INPUT/OUTPUT/FORWARD directly
_RUN_TIMEOUT = 6.0


class PolicyError(ValueError):
    """Raised when a request violates the response policy. Maps to HTTP 403/422."""


@dataclass
class Plan:
    action_type: str
    target_ip: str | None
    feasible: bool
    mode: str
    argv: list[str]
    rollback_argv: list[str]
    summary: str
    blockers: list[str]
    warnings: list[str]
    executor: str

    def as_dict(self) -> dict:
        def render(argv: list[str]) -> str:
            return " ".join(argv)

        return {
            "action_type": self.action_type,
            "target_ip": self.target_ip,
            "feasible": self.feasible,
            "mode": self.mode,
            "summary": self.summary,
            "blockers": self.blockers,
            "warnings": self.warnings,
            "executor": self.executor,
            "command_preview": render(self.argv) if self.argv else None,
            "rollback_preview": render(self.rollback_argv) if self.rollback_argv else None,
        }


def classify(event: dict) -> dict:
    """
    Turn a raw event into an analyst-facing classification.

    Deliberately rule-based and explainable - an interview-ready SOC tool should
    be able to justify every label it prints.
    """
    signature = (event.get("signature") or "").lower()
    proto = (event.get("proto") or "").upper()
    action = event.get("action") or "unknown"
    severity = event.get("severity") or "unknown"
    rule_id = event.get("rule_id")

    if "icmp" in signature or proto == "ICMP":
        category = "policy-test / ICMP probe"
        technique = "T1018 / T1095 (host/network discovery)"
    elif any(word in signature for word in ("scan", "nmap", "sweep", "syn")):
        category = "network reconnaissance"
        technique = "T1046 (network service discovery)"
    elif any(word in signature for word in ("web", "http", "sql", "xss", "shell")):
        category = "web application attack"
        technique = "T1190 (exploit public-facing application)"
    elif any(word in signature for word in ("dns", "tunnel", "beacon", "c2", "malware")):
        category = "command-and-control / exfiltration"
        technique = "T1071 (application layer protocol)"
    else:
        category = "network anomaly / custom rule"
        technique = "unmapped"

    if severity == "high" or action == "blocked":
        priority = "P1"
    elif severity == "medium":
        priority = "P2"
    else:
        priority = "P3"

    if action == "blocked":
        recommendation = (
            "Traffic was already dropped by the IPS. Preserve the evidence, confirm the "
            "rule and the traffic path, and record the outcome. No further blocking action "
            "is required."
        )
        suggested = None
    elif action == "allowed":
        recommendation = (
            "Detection-only rule fired and traffic was permitted. Decide whether this "
            "should become a drop rule; if the source is an approved test host, block the "
            "source IP on the local firewall only in enforce mode with the host allow-listed."
        )
        suggested = "block_source_ip"
    else:
        recommendation = (
            "The recorded action is unknown - the event does not state whether traffic was "
            "passed or dropped. Corroborate with flow records and the sensor configuration "
            "before drawing any conclusion."
        )
        suggested = None

    return {
        "category": category,
        "technique": technique,
        "priority": priority,
        "recommendation": recommendation,
        "suggested_action": suggested,
        "basis": {
            "signature": event.get("signature"),
            "rule_id": rule_id,
            "protocol": proto,
            "severity": severity,
            "recorded_action": action,
            "action_source": event.get("action_source"),
            "custom_rule": event.get("is_custom_rule", False),
        },
    }


class ResponseEngine:
    def __init__(self, settings: Settings | None = None, audit: AuditStore | None = None) -> None:
        self._settings = settings or get_settings()
        self._audit = audit or AuditStore(self._settings.audit_db_path)

    # -- helpers ---------------------------------------------------------
    def _validate_ip(self, raw: str | None) -> str:
        if not raw:
            raise PolicyError("target_ip is required for firewall actions")
        try:
            addr = ipaddress.ip_address(raw.strip())
        except ValueError as exc:
            raise PolicyError(f"'{raw}' is not a valid IP address") from exc
        if addr.is_unspecified or addr.is_multicast or addr.is_reserved:
            raise PolicyError(f"{raw} is not a usable host address for a firewall rule")
        return str(addr)

    def _is_allowlisted(self, ip: str) -> bool:
        for entry in self._settings.response_allowlist:
            entry = entry.strip()
            if not entry:
                continue
            if ip == entry:
                return True
            try:  # allow CIDR entries, e.g. 192.168.10.0/24
                if "/" in entry and ipaddress.ip_address(ip) in ipaddress.ip_network(entry, strict=False):
                    return True
            except ValueError:
                continue
        return False

    def firewall_backend(self) -> str | None:
        for backend in ("iptables", "nft", "ufw"):
            if shutil.which(backend):
                return backend
        return None

    # -- plan ------------------------------------------------------------
    def build_plan(self, event: dict, action_type: str, target_ip: str | None) -> Plan:
        st = self._settings
        mode = st.response_mode if st.response_mode in VALID_MODES else "recommend"
        warnings: list[str] = []
        blockers: list[str] = []

        ip: str | None = None
        argv: list[str] = []
        rollback: list[str] = []
        summary = ""
        executor = "none (recommendation only)"

        if action_type in {"block_source_ip", "unblock_source_ip"}:
            ip = self._validate_ip(target_ip or event.get("src_ip"))
            if not self._is_allowlisted(ip):
                blockers.append(
                    f"{ip} is not in SOC_RESPONSE_ALLOWLIST. Arbitrary addresses are never "
                    "acted on - add the lab host explicitly if you intend to manage it."
                )
            backend = self.firewall_backend()
            if backend is None:
                blockers.append(
                    "no local firewall tool (iptables/nft/ufw) found on this host - nothing to execute"
                )
            else:
                executor = f"local {backend} (dedicated chain {CHAIN})"
                if backend == "iptables":
                    if action_type == "block_source_ip":
                        summary = f"Append DROP for source {ip} to local chain {CHAIN}"
                        argv = ["iptables", "-A", CHAIN, "-s", ip, "-j", "DROP"]
                        rollback = ["iptables", "-D", CHAIN, "-s", ip, "-j", "DROP"]
                    else:
                        argv = ["iptables", "-D", CHAIN, "-s", ip, "-j", "DROP"]
                        rollback = ["iptables", "-A", CHAIN, "-s", ip, "-j", "DROP"]
                        summary = f"Remove DROP rule for source {ip} from local chain {CHAIN}"
                elif backend == "nft":
                    if action_type == "block_source_ip":
                        argv = ["nft", "add", "element", "inet", "sentinel_soc", "blocked_v4", "{", ip, "}"]
                        rollback = ["nft", "delete", "element", "inet", "sentinel_soc", "blocked_v4", "{", ip, "}"]
                        summary = f"Add {ip} to nftables set sentinel_soc blocked_v4"
                    else:
                        argv = ["nft", "delete", "element", "inet", "sentinel_soc", "blocked_v4", "{", ip, "}"]
                        rollback = ["nft", "add", "element", "inet", "sentinel_soc", "blocked_v4", "{", ip, "}"]
                        summary = f"Remove {ip} from nftables set sentinel_soc blocked_v4"
                else:  # ufw
                    if action_type == "block_source_ip":
                        argv = ["ufw", "insert", "1", "deny", "from", ip]
                        rollback = ["ufw", "delete", "deny", "from", ip]
                        summary = f"Insert a ufw deny rule for {ip}"
                    else:
                        argv = ["ufw", "delete", "deny", "from", ip]
                        rollback = ["ufw", "insert", "1", "allow", "from", ip]
                        summary = f"Remove the ufw deny rule for {ip}"
                warnings.append(
                    "The rule is applied to THIS host only. It does not touch the Cisco "
                    "ASA, routers, Packet Tracer or any remote device."
                )
        elif action_type == "quarantine_flow":
            blockers.append(
                "Flow quarantine is intentionally not implemented: blocking a 5-tuple on a "
                "live sensor needs the sensor's own inline path and is out of scope for the "
                "first version. Use an IPS drop rule on the sensor instead."
            )
            summary = "Not implemented by design"
        else:
            raise PolicyError(f"unknown action_type '{action_type}'")

        if st.live_enabled:
            warnings.append(
                "Live capture is enabled, so a local firewall rule could interrupt "
                "Suricata's own traffic path. Verify the chain and the sensor's interfaces "
                "before enforcing."
            )

        feasible = not blockers
        return Plan(
            action_type=action_type,
            target_ip=ip,
            feasible=feasible,
            mode=mode,
            argv=argv,
            rollback_argv=rollback,
            summary=summary,
            blockers=blockers,
            warnings=warnings,
            executor=executor,
        )

    # -- execute ---------------------------------------------------------
    def submit(
        self,
        *,
        event: dict | None,
        event_id: str,
        action_type: str,
        target_ip: str | None,
        reason: str,
        confirm: bool,
        authorization: str,
        actor: str = "dashboard-analyst",
    ) -> dict:
        st = self._settings
        mode = st.response_mode if st.response_mode in VALID_MODES else "recommend"
        record = event or {}

        try:
            plan = self.build_plan(record, action_type, target_ip)
        except PolicyError as exc:
            audit_id = self._audit.record_audit(
                kind="response_action",
                actor=actor,
                status="rejected",
                event_id=event_id,
                action_type=action_type,
                target=target_ip,
                mode=mode,
                detail=f"policy error: {exc}",
                result={"error": str(exc)},
            )
            raise PolicyError(str(exc)) from exc

        # --- gates -----------------------------------------------------
        if mode == "enforce":
            if not confirm:
                reason_text = "confirmation flag missing (confirm=true required in enforce mode)"
                self._audit.record_audit(
                    kind="response_action", actor=actor, status="refused", event_id=event_id,
                    action_type=action_type, target=plan.target_ip, mode=mode,
                    detail=reason_text, result=plan.as_dict(),
                )
                raise PolicyError(reason_text)
            if len(authorization.strip()) < 8:
                reason_text = (
                    "an authorisation statement (>= 8 characters) is required in enforce mode - "
                    "the platform will not change firewall state without a recorded basis"
                )
                self._audit.record_audit(
                    kind="response_action", actor=actor, status="refused", event_id=event_id,
                    action_type=action_type, target=plan.target_ip, mode=mode,
                    detail=reason_text, result=plan.as_dict(),
                )
                raise PolicyError(reason_text)
            recent = self._audit.recent_actions_count(window_hours=1)
            if recent >= st.response_max_actions_per_hour:
                reason_text = (
                    f"rate limit reached: {recent} executed action(s) in the last hour "
                    f"(limit {st.response_max_actions_per_hour}). This is a circuit breaker "
                    "against a runaway rule or a repeating event storm."
                )
                self._audit.record_audit(
                    kind="response_action", actor=actor, status="rate_limited", event_id=event_id,
                    action_type=action_type, target=plan.target_ip, mode=mode,
                    detail=reason_text, result=plan.as_dict(),
                )
                raise PolicyError(reason_text)
            if not plan.feasible:
                reason_text = "plan is not feasible: " + "; ".join(plan.blockers)
                self._audit.record_audit(
                    kind="response_action", actor=actor, status="blocked_by_policy",
                    event_id=event_id, action_type=action_type, target=plan.target_ip,
                    mode=mode, detail=reason_text, result=plan.as_dict(),
                )
                raise PolicyError(reason_text)

        # --- audit the intent -------------------------------------------
        audit_id = self._audit.record_audit(
            kind="response_action",
            actor=actor,
            status="planned",
            event_id=event_id,
            action_type=action_type,
            target=plan.target_ip,
            mode=mode,
            detail=f"{reason} | {plan.summary}",
            rollback=plan.as_dict().get("rollback_preview"),
            result=plan.as_dict(),
        )

        if mode == "recommend":
            message = (
                "Recommendation recorded. Nothing was executed - the platform is in "
                "'recommend' mode, so no firewall state changed anywhere."
            )
            self._audit.record_audit(
                kind="response_action", actor=actor, status="recommended", event_id=event_id,
                action_type=action_type, target=plan.target_ip, mode=mode,
                detail=message, rollback=plan.as_dict().get("rollback_preview"),
            )
            return self._result(event_id, False, False, mode, plan, audit_id, message)

        if mode == "dry_run":
            message = (
                "Dry run: the command below was validated and NOT executed. "
                f"Executor that would be used: {plan.executor}."
            )
            self._audit.record_audit(
                kind="response_action", actor=actor, status="dry_run", event_id=event_id,
                action_type=action_type, target=plan.target_ip, mode=mode,
                detail=message, rollback=plan.as_dict().get("rollback_preview"),
                result=plan.as_dict(),
            )
            return self._result(event_id, False, False, mode, plan, audit_id, message)

        # --- enforce (local host only) ----------------------------------
        if not plan.argv:
            message = "Nothing to execute: the plan produced no command."
            self._audit.record_audit(
                kind="response_action", actor=actor, status="noop", event_id=event_id,
                action_type=action_type, target=plan.target_ip, mode=mode, detail=message,
            )
            return self._result(event_id, False, False, mode, plan, audit_id, message)

        try:
            proc = subprocess.run(
                plan.argv, capture_output=True, text=True, timeout=_RUN_TIMEOUT, check=False
            )
            ok = proc.returncode == 0
            output = ((proc.stdout or "") + (proc.stderr or "")).strip()[:1000]
        except (OSError, subprocess.SubprocessError) as exc:
            ok, output = False, f"execution error: {exc}"

        status = "executed" if ok else "failed"
        message = (
            f"{plan.summary} - {'applied' if ok else 'FAILED'} on this host "
            f"(audit #{audit_id}). Rollback: {plan.as_dict().get('rollback_preview')}"
        )
        self._audit.record_audit(
            kind="response_action", actor=actor, status=status, event_id=event_id,
            action_type=action_type, target=plan.target_ip, mode=mode, detail=message,
            rollback=plan.as_dict().get("rollback_preview"),
            result={"argv": plan.argv, "returncode": None if ok else 1, "output": output},
        )
        return self._result(event_id, True, ok, mode, plan, audit_id, message)

    @staticmethod
    def _result(
        event_id: str,
        accepted: bool,
        executed: bool,
        mode: str,
        plan: Plan,
        audit_id: int,
        message: str,
    ) -> dict:
        # Blockers are shown even when nothing was executed: an analyst must be
        # able to see why the platform would refuse to enforce this action.  # noqa: D401
        return {
            "accepted": accepted,
            "executed": executed,
            "mode": mode,
            "action_type": plan.action_type,
            "target_ip": plan.target_ip,
            "event_id": event_id,
            "audit_id": audit_id,
            "plan": plan.as_dict(),
            "message": message,
            "warnings": plan.warnings + plan.blockers,
        }

    def status(self) -> dict:
        backend = self.firewall_backend()
        return {
            "mode": self._settings.response_mode,
            "valid_modes": sorted(VALID_MODES),
            "secure_default": "recommend",
            "allowlist": list(self._settings.response_allowlist),
            "allowlist_configured": bool(self._settings.response_allowlist),
            "local_firewall_backend": backend or "none detected",
            "max_actions_per_hour": self._settings.response_max_actions_per_hour,
            "recent_executed_actions": self._audit.recent_actions_count(1),
            "dry_run_supported": True,
            "capabilities": [
                "classification and prioritisation",
                "recommendation with explicit basis",
                "dry-run command preview",
                "local-host firewall action for allow-listed targets only",
                "full audit trail with rollback command",
            ],
            "explicitly_out_of_scope": [
                "remote device configuration (routers, switches, ASA, Packet Tracer)",
                "arbitrary command execution endpoints",
                "blocking addresses that are not on the allow list",
                "automatic blocking without operator confirmation",
            ],
        }
