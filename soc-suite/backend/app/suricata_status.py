"""
Read-only probes for the Suricata host.

Everything here is observational. We never start, stop, reconfigure or
"fix" Suricata from the API -- enabling an engine or installing an IPS rule is
an operator decision made on the box, with the traffic path understood first.

Every probe result carries `checked` / `checked_at` so the UI can say
"not checked" instead of guessing.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from .settings import Settings

# Fixed argv probes only. No user input ever reaches a subprocess.
_SAFE_TIMEOUT = 4.0

# Common places a Suricata rule file lives, probed for *visibility* only
# (the API never edits them -- see docs/05).
RULE_DIRS = (Path("/etc/suricata/rules"), Path("/var/lib/suricata/rules"))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _file_facts(path: Path) -> dict:
    facts = {
        "path": str(path),
        "exists": False,
        "readable": False,
        "size_bytes": None,
        "modified_at": None,
        "age_seconds": None,
        "error": None,
    }
    try:
        stat = path.stat()
    except FileNotFoundError:
        facts["error"] = "file not found"
        return facts
    except PermissionError:
        facts["exists"] = True
        facts["error"] = "permission denied"
        return facts
    except OSError as exc:
        facts["error"] = str(exc)
        return facts

    facts.update(
        exists=True,
        readable=os.access(path, os.R_OK),
        size_bytes=stat.st_size,
        modified_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
        age_seconds=int(datetime.now(timezone.utc).timestamp() - stat.st_mtime),
    )
    return facts


def _run(argv: list[str]) -> tuple[bool, str]:
    """Run a fixed, read-only command. Returns (ok, output-or-error)."""
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=_SAFE_TIMEOUT,
            check=False,
        )
    except FileNotFoundError:
        return False, "command not found"
    except subprocess.TimeoutExpired:
        return False, "probe timed out"
    except OSError as exc:  # pragma: no cover
        return False, f"probe failed: {exc}"
    output = (proc.stdout or proc.stderr or "").strip()
    return proc.returncode == 0, output[:400]


def _process_count() -> int | None:
    """Count local Suricata processes without shelling out."""
    proc_root = Path("/proc")
    if not proc_root.is_dir():
        return None
    count = 0
    try:
        for entry in proc_root.iterdir():
            if not entry.name.isdigit():
                continue
            try:
                comm = (entry / "comm").read_text(errors="replace").strip()
            except (OSError, PermissionError):
                continue
            if comm.startswith("suricata"):
                count += 1
    except (OSError, PermissionError):
        return None
    return count


def _rule_files() -> list[dict]:
    found: list[dict] = []
    for directory in RULE_DIRS:
        if not directory.is_dir():
            continue
        try:
            for path in sorted(directory.glob("*.rules")):
                try:
                    stat = path.stat()
                except OSError:
                    continue
                found.append(
                    {
                        "path": str(path),
                        "size_bytes": stat.st_size,
                        "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
                        .isoformat()
                        .replace("+00:00", "Z"),
                        "readable": os.access(path, os.R_OK),
                    }
                )
        except (OSError, PermissionError):
            continue
    return found


def collect(settings: Settings, eve_path: Path | None = None) -> dict:
    """
    Build the Suricata portion of /api/system/status.

    `service_state` is intentionally coarse: "active", "inactive", "unknown",
    "not-probed" and "not-installed" are all distinct answers.
    """
    result: dict = {
        "checked_at": _now(),
        "checked": True,
        "note": "",
        "binary_present": False,
        "binary_path": None,
        "service_state": "unknown",
        "service_probe": "",
        "process_count": _process_count(),
        "eve_file": _file_facts(eve_path or settings.live_eve_path),
        "fast_log": _file_facts(settings.suricata_fast_log),
        "stats_log": _file_facts(settings.suricata_stats_log),
        "rule_files_visible": _rule_files(),
        "interpretation": "",
    }

    binary = shutil.which(settings.suricata_binary)
    if binary:
        result["binary_present"] = True
        result["binary_path"] = binary
        ok, output = _run([binary, "--version"])
        result["version"] = output.splitlines()[0].strip() if ok and output else None
    else:
        result["version"] = None

    # Service state: prefer systemctl (authoritative), fall back to /proc.
    service_state = "unknown"
    probe_note = ""
    if settings.systemctl_probe and shutil.which("systemctl"):
        ok, output = _run(["systemctl", "is-active", settings.suricata_binary])
        probe_note = f"systemctl is-active {settings.suricata_binary}: {output!r}"
        if ok and output in {"active", "activating", "reloading"}:
            service_state = "active"
        elif output in {"inactive", "failed", "deactivating"}:
            service_state = output
        elif not ok and output:
            service_state = output if output in {"inactive", "failed"} else "unknown"
    elif not shutil.which("systemctl"):
        probe_note = "systemctl not available on this host"

    if service_state == "unknown" and result["process_count"]:
        # No systemd (container, or non-systemd distro) but the process exists.
        service_state = "active (process detected, no systemd probe)"
    result["service_state"] = service_state
    result["service_probe"] = probe_note

    if not result["binary_present"]:
        result["note"] = (
            "Suricata binary not found on this host. Running the API on a different "
            "machine than the sensor? Point SOC_LIVE_EVE_PATH at the EVE file "
            "(a shared mount or rsync copy) and the dashboard will read events, "
            "but process/service status cannot be measured from here."
        )
    elif service_state not in {"active", } and "active (" not in service_state:
        result["note"] = (
            "Suricata is not reporting as active. No events will be produced until "
            "it is started -- and it must not be restarted blindly if an IPS mode "
            "was configured earlier; verify the traffic path and rules first."
        )
    else:
        result["note"] = "Suricata appears to be running on this host."

    eve = result["eve_file"]
    if eve.get("exists") and eve.get("size_bytes") == 0:
        result["interpretation"] = (
            "EVE log exists but is empty: zero alerts have been written since Suricata "
            "last started. Historical, rotated logs are the correct place to look for "
            "the earlier IDS/IPS test evidence."
        )
    elif not eve.get("exists"):
        result["interpretation"] = "No EVE log at the configured path."
    else:
        result["interpretation"] = (
            "EVE log present; the Data Sources view shows how many alert events were "
            "read from it and whether they are live or historical."
        )
    return result
