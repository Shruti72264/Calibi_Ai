"""
Backend test suite - pytest.

These tests are the executable part of docs/07_TEST_PLAN.md. They use the
FastAPI TestClient, so they exercise real HTTP routing, validation and
serialisation - not the handler functions in isolation.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.audit import AuditStore
from app.datasource import EventStore
from app.main import app
from app.parser import normalize_event, read_events
from app.response.actions import PolicyError, ResponseEngine, classify
from app.settings import Settings

REPO_BACKEND = Path(__file__).resolve().parent.parent
HISTORY = REPO_BACKEND / "data" / "historical" / "eve-alerts-history.json"


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


# --------------------------------------------------------------------------
# parser
# --------------------------------------------------------------------------
class TestParser:
    def test_normalize_alert_record(self):
        record = {
            "timestamp": "2026-09-28T18:05:03.221904+0000",
            "flow_id": 999,
            "event_type": "alert",
            "src_ip": "192.168.61.129",
            "dest_ip": "8.8.8.8",
            "proto": "ICMP",
            "alert": {
                "action": "blocked",
                "signature_id": 1000002,
                "signature": "LOCAL IPS TEST - ICMP BLOCKED",
                "severity": 1,
            },
        }
        event = normalize_event(record, source="historical", source_file="x.json")
        assert event["action"] == "blocked"
        assert event["severity"] == "high"
        assert event["rule_id"] == 1000002
        assert event["is_custom_rule"] is True
        assert event["timestamp"].endswith("Z")

    def test_action_is_never_guessed(self):
        """A record that says nothing about its verdict must not become 'allowed'."""
        event = normalize_event(
            {"timestamp": "2026-01-01T00:00:00.000000+0000", "event_type": "alert", "alert": {}},
            source="live",
            source_file="x.json",
        )
        assert event["action"] == "unknown"
        assert "not recorded" in event["action_source"]

    def test_invalid_and_truncated_lines_are_skipped(self, tmp_path: Path):
        broken = tmp_path / "eve.json"
        broken.write_text(
            '{"timestamp":"2026-01-01T00:00:00.000000+0000","event_type":"alert",'
            '"src_ip":"10.0.0.9","alert":{"signature":"A","signature_id":1,"action":"allowed"}}\n'
            '{"timestamp": "truncated\n'
            "not json at all\n"
            "\n"
            '{"timestamp":"2026-01-01T00:00:05.000000+0000","event_type":"alert",'
            '"src_ip":"10.0.0.10","alert":{"signature":"B","signature_id":2,"action":"blocked"}}\n',
            encoding="utf-8",
        )
        events, stats = read_events(broken, source="live")
        assert len(events) == 2
        assert stats.lines_invalid == 2
        assert stats.error is None

    def test_missing_file_reports_instead_of_raising(self, tmp_path: Path):
        events, stats = read_events(tmp_path / "nope.json", source="live")
        assert events == []
        assert stats.exists is False
        assert stats.error == "file not found"

    def test_empty_file_is_handled(self, tmp_path: Path):
        empty = tmp_path / "eve.json"
        empty.touch()
        events, stats = read_events(empty, source="live")
        assert events == []
        assert stats.exists is True
        assert stats.size_bytes == 0

    def test_gzip_evidence_supported(self, tmp_path: Path):
        import gzip

        target = tmp_path / "eve.json.1.gz"
        with gzip.open(target, "wt", encoding="utf-8") as fh:
            fh.write(
                '{"timestamp":"2026-01-01T00:00:00.000000+0000","event_type":"alert",'
                '"alert":{"signature":"GZ","signature_id":3,"action":"allowed"}}\n'
            )
        events, stats = read_events(target, source="historical")
        assert len(events) == 1 and stats.readable


# --------------------------------------------------------------------------
# API: health, alerts, filters, pagination
# --------------------------------------------------------------------------
class TestAlertsAPI:
    def test_health_reports_sources_separately(self, client: TestClient):
        response = client.get("/api/health")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] in {"ok", "degraded"}
        sources = {s["source"]: s for s in body["data_sources"]}
        assert set(sources) == {"live", "historical"}
        assert "state" in sources["live"]

    def test_historical_alerts_parse_from_evidence_file(self, client: TestClient):
        response = client.get("/api/alerts", params={"source": "historical", "page_size": 200})
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 12
        assert body["counts_by_source"]["historical"] == 12
        assert all(item["source"] == "historical" for item in body["items"])

    def test_both_custom_rules_present_including_ips_block(self, client: TestClient):
        body = client.get("/api/alerts", params={"page_size": 200}).json()
        rule_ids = {item["rule_id"] for item in body["items"]}
        assert rule_ids == {1000001, 1000002}
        blocked = [i for i in body["items"] if i["action"] == "blocked"]
        assert blocked, "the real IPS blocked event must be present"
        assert all(i["rule_id"] == 1000002 for i in blocked)
        assert all(i["severity"] == "high" for i in blocked)

    def test_filter_by_signature(self, client: TestClient):
        body = client.get("/api/alerts", params={"signature": "IPS", "page_size": 200}).json()
        assert body["total"] == 4
        assert all("IPS" in item["signature"] for item in body["items"])

    def test_filter_by_action_and_severity(self, client: TestClient):
        body = client.get(
            "/api/alerts", params=[("action", "blocked"), ("severity", "high"), ("page_size", 200)]
        ).json()
        assert body["total"] == 4
        assert all(i["action"] == "blocked" and i["severity"] == "high" for i in body["items"])

    def test_filter_by_ip(self, client: TestClient):
        body = client.get("/api/alerts", params={"src_ip": "192.168.61.129", "page_size": 200}).json()
        assert body["total"] == 12
        empty = client.get("/api/alerts", params={"src_ip": "10.9.9.9"}).json()
        assert empty["total"] == 0 and empty["items"] == []

    def test_pagination_maths(self, client: TestClient):
        first = client.get("/api/alerts", params={"page": 1, "page_size": 5}).json()
        second = client.get("/api/alerts", params={"page": 2, "page_size": 5}).json()
        assert first["pages"] == 3 and first["total"] == 12
        assert len(first["items"]) == 5 and len(second["items"]) == 5
        ids_a = {i["event_id"] for i in first["items"]}
        ids_b = {i["event_id"] for i in second["items"]}
        assert not ids_a & ids_b, "pages must not overlap"

    def test_sorting_both_directions(self, client: TestClient):
        ascending = client.get(
            "/api/alerts", params={"sort": "timestamp", "order": "asc", "page_size": 200}
        ).json()["items"]
        descending = client.get(
            "/api/alerts", params={"sort": "timestamp", "order": "desc", "page_size": 200}
        ).json()["items"]
        assert ascending[0]["timestamp"] == descending[-1]["timestamp"]

    def test_free_text_search(self, client: TestClient):
        body = client.get("/api/alerts", params={"q": "icmp", "page_size": 200}).json()
        assert body["total"] == 12

    def test_rejects_invalid_pagination(self, client: TestClient):
        assert client.get("/api/alerts", params={"page": 0}).status_code == 422
        assert client.get("/api/alerts", params={"page_size": 5000}).status_code == 422
        assert client.get("/api/alerts", params={"window": "banana"}).status_code == 422

    def test_empty_live_log_returns_zero_not_error(self, client: TestClient):
        body = client.get("/api/alerts", params={"source": "live"}).json()
        assert body["total"] == 0
        assert body["items"] == []


class TestEventDetail:
    def _first_id(self, client: TestClient) -> str:
        return client.get("/api/alerts", params={"page_size": 1}).json()["items"][0]["event_id"]

    def test_detail_includes_related_and_timeline(self, client: TestClient):
        event_id = self._first_id(client)
        body = client.get(f"/api/alerts/{event_id}").json()
        assert body["event"]["event_id"] == event_id
        assert body["related"]["by_source_ip"]
        assert body["response_recommendation"]["category"]
        assert any(node["kind"] == "focal" for node in body["timeline"])

    def test_unknown_event_is_404_with_guidance(self, client: TestClient):
        response = client.get("/api/alerts/deadbeefdeadbeef")
        assert response.status_code == 404
        assert "rotated out" in response.json()["detail"]


class TestStatsAPI:
    def test_totals_match_evidence(self, client: TestClient):
        body = client.get("/api/stats").json()
        assert body["totals"]["events"] == 12
        assert body["totals"]["blocked"] == 4
        assert body["totals"]["allowed"] == 8
        assert body["totals"]["unknown_action"] == 0
        assert body["custom_rule_events"] == 12
        actions = {d["key"]: d["count"] for d in body["action_distribution"]}
        assert actions == {"allowed": 8, "blocked": 4}

    def test_timeline_buckets_present(self, client: TestClient):
        body = client.get("/api/stats").json()
        assert body["timeline"]
        assert sum(bucket["total"] for bucket in body["timeline"]) == 12

    def test_window_filter_narrows_results(self, client: TestClient):
        wide = client.get("/api/stats", params={"window": "all"}).json()
        narrow = client.get("/api/stats", params={"window": "1h"}).json()
        assert wide["totals"]["events"] == 12
        assert narrow["totals"]["events"] == 0  # evidence is weeks old, correctly excluded


class TestNetworkAPI:
    def test_evidence_pack_loads_with_correct_labels(self, client: TestClient):
        body = client.get("/api/network/status").json()
        assert body["evidence_pack"]["available"] is True
        assert body["data_class"] == "simulation-evidence"
        statuses = {d["evidence_status"] for d in body["devices"]}
        assert statuses <= {"verified", "simulated", "unknown", "unavailable"}
        assert body["provider_mode"] == "evidence"

    def test_known_addressing_is_present(self, client: TestClient):
        body = client.get("/api/network/status").json()
        addresses = {
            a["ip"] for device in body["devices"] for a in device.get("addresses", [])
        }
        for expected in (
            "192.168.10.1", "192.168.10.254", "192.168.10.11", "192.168.10.13",
            "192.168.20.1", "192.168.20.10", "192.168.30.1", "192.168.30.10",
            "10.0.0.1", "10.0.0.2", "203.0.113.1", "203.0.113.2", "203.0.114.1",
            "203.0.114.10", "10.10.10.1", "10.10.10.2",
        ):
            assert expected in addresses, f"{expected} missing from the topology data"

    def test_vpn_limitation_is_documented_not_invented(self, client: TestClient):
        body = client.get("/api/network/status").json()
        vpn = [e for e in body["evidence"] if e["area"] == "vpn_limitation"]
        assert vpn and vpn[0]["result"] == "NOT COMPLETED"
        assert vpn[0]["status"] == "unavailable"

    def test_live_collection_is_honest(self, client: TestClient):
        body = client.get("/api/network/status").json()
        live = body["live_collection"]
        assert live["supported_by_devices"] is False
        assert live["probes"] == []


class TestSystemAPI:
    def test_system_status_shape(self, client: TestClient):
        body = client.get("/api/system/status").json()
        assert "suricata" in body and "cisco" in body and "response" in body
        assert body["suricata"]["checked"] is True
        assert body["cisco"]["provider_mode"] == "evidence"
        assert "write_protection" in body["backend"]

    def test_suricata_status_never_claims_unchecked_state(self, client: TestClient):
        body = client.get("/api/suricata/status").json()
        assert body["checked"] is True
        assert body["service_state"] in {
            "active", "inactive", "failed", "deactivating", "activating",
            "unknown", "not-probed", "not-installed",
        } or body["service_state"].startswith("active (process")

    def test_file_probe_reports_emptiness(self, client: TestClient):
        body = client.get("/api/system/status").json()
        assert isinstance(body["files"], list) and body["files"]
        assert all("exists" in f and "size_bytes" in f for f in body["files"])


# --------------------------------------------------------------------------
# write protection + response policy
# --------------------------------------------------------------------------
class TestSecurityPosture:
    def test_mutating_routes_are_closed_by_default(self, client: TestClient):
        """Fail-closed: no key configured -> 403, never a silent write."""
        response = client.post(
            "/api/alerts/someeventid/notes", json={"note": "hello", "author": "test"}
        )
        assert response.status_code == 403
        assert "read-only" in response.json()["detail"]

    def test_response_action_route_requires_confirmation_and_allowlist(self, client: TestClient):
        # default mode is `recommend`: recorded, never executed
        body = client.get("/api/alerts", params={"page_size": 1}).json()["items"][0]
        response = client.post(
            "/api/response/actions",
            json={
                "event_id": body["event_id"],
                "action_type": "block_source_ip",
                "target_ip": "192.168.61.129",
                "reason": "unit test",
            },
        )
        assert response.status_code == 200
        result = response.json()
        assert result["executed"] is False
        assert result["mode"] == "recommend"
        assert "unchanged" in result["message"]

    def test_no_endpoint_accepts_a_command_or_path(self):
        """Guard against a future commit accidentally adding a shell endpoint."""
        paths = {route.path for route in app.routes}
        forbidden = {"command", "exec", "shell", "run", "file", "read", "path"}
        assert not {p for p in paths if any(word in p.lower() for word in forbidden)}


class TestResponseEnginePolicy:
    def _engine(self, tmp_path: Path, **overrides) -> ResponseEngine:
        """A ResponseEngine with explicit settings, independent of the environment."""
        from dataclasses import replace

        settings = replace(
            Settings(),
            response_mode=overrides.get("mode", "recommend"),
            response_allowlist=tuple(overrides.get("allowlist", ())),
            audit_db_path=tmp_path / "audit.sqlite3",
            response_max_actions_per_hour=overrides.get("limit", 10),
        )
        return ResponseEngine(settings, AuditStore(settings.audit_db_path))

    def test_arbitrary_ip_is_refused(self, tmp_path: Path):
        """A target that is not on the allow list can never produce an executable plan."""
        engine = self._engine(tmp_path, mode="enforce", allowlist=("10.0.0.5",))
        plan = engine.build_plan({"src_ip": "203.0.113.77"}, "block_source_ip", "203.0.113.77")
        assert plan.feasible is False
        assert any("allow" in blocker.lower() for blocker in plan.blockers)
        assert plan.argv == [], "no command may be built for a non-allow-listed target"

    def test_invalid_ip_is_refused(self, tmp_path: Path):
        engine = self._engine(tmp_path)
        with pytest.raises(PolicyError):
            engine.build_plan({}, "block_source_ip", "not-an-ip")

    def test_allowlisted_ip_is_planned_with_rollback(self, tmp_path: Path):
        engine = self._engine(tmp_path, mode="dry_run", allowlist=("192.168.61.129",))
        plan = engine.build_plan({}, "block_source_ip", "192.168.61.129")
        assert plan.target_ip == "192.168.61.129"

        if engine.firewall_backend() is None:
            # Nothing to execute on a host with no firewall tool - the engine must
            # say so rather than pretend it produced a rule.
            assert plan.feasible is False
            assert any("firewall" in blocker for blocker in plan.blockers)
        else:
            assert plan.feasible is True
            rendered = plan.as_dict()
            assert rendered["command_preview"] and rendered["rollback_preview"]
            assert plan.target_ip in rendered["command_preview"]
            assert plan.target_ip in rendered["rollback_preview"]

    def test_enforce_requires_confirmation(self, tmp_path: Path):
        engine = self._engine(tmp_path, mode="enforce", allowlist=("192.168.61.129",))
        with pytest.raises(PolicyError) as excinfo:
            engine.submit(
                event={"src_ip": "192.168.61.129"}, event_id="abc12345",
                action_type="block_source_ip", target_ip="192.168.61.129",
                reason="test", confirm=False, authorization="",
            )
        assert "confirm" in str(excinfo.value)

    def test_enforce_requires_authorisation_statement(self, tmp_path: Path):
        engine = self._engine(tmp_path, mode="enforce", allowlist=("192.168.61.129",))
        with pytest.raises(PolicyError) as excinfo:
            engine.submit(
                event={"src_ip": "192.168.61.129"}, event_id="abc12345",
                action_type="block_source_ip", target_ip="192.168.61.129",
                reason="test", confirm=True, authorization="",
            )
        assert "authorisation" in str(excinfo.value).lower()

    def test_every_attempt_is_audited_even_when_refused(self, tmp_path: Path):
        engine = self._engine(tmp_path, mode="enforce", allowlist=("192.168.61.129",))
        with pytest.raises(PolicyError):
            engine.submit(
                event={}, event_id="abc12345", action_type="block_source_ip",
                target_ip="8.8.8.8", reason="attempt", confirm=True,
                authorization="authorised lab test",
            )
        log = engine._audit.audit_log()  # noqa: SLF001 - intentional white-box check
        assert log, "a refused action must still leave an audit trail"
        assert log[0]["status"] == "blocked_by_policy"
        assert log[0]["target"] == "8.8.8.8"
        assert "allow" in (log[0]["detail"] or "").lower()

    def test_flow_quarantine_is_not_implemented(self, tmp_path: Path):
        engine = self._engine(tmp_path)
        plan = engine.build_plan({}, "quarantine_flow", None)
        assert plan.feasible is False
        assert "not implemented" in plan.summary.lower()

    def test_rate_limit_is_a_circuit_breaker(self, tmp_path: Path):
        engine = self._engine(tmp_path, mode="enforce", allowlist=("192.168.61.129",), limit=1)
        for _ in range(2):
            try:
                engine.submit(
                    event={}, event_id="abc12345", action_type="block_source_ip",
                    target_ip="192.168.61.129", reason="loop", confirm=True,
                    authorization="authorised lab test",
                )
            except PolicyError:
                pass
        # After the single allowed attempt the second must be refused by policy
        # (either rate limit or an unfeasible plan) - never silently executed twice.
        assert engine._audit.recent_actions_count(1) <= 1


class TestClassifier:
    def test_icmp_detection_rule_is_classified(self):
        result = classify(
            {"signature": "LOCAL IDS TEST", "proto": "ICMP", "action": "allowed", "severity": "low"}
        )
        assert result["priority"] == "P3"
        assert result["suggested_action"] == "block_source_ip"
        assert "ICMP" in result["basis"]["protocol"]

    def test_blocked_high_severity_is_p1_with_no_further_action(self):
        result = classify(
            {
                "signature": "LOCAL IPS TEST - ICMP BLOCKED",
                "proto": "ICMP",
                "action": "blocked",
                "severity": "high",
            }
        )
        assert result["priority"] == "P1"
        assert result["suggested_action"] is None
        assert "already dropped" in result["recommendation"]

    def test_unknown_action_is_called_out(self):
        result = classify({"signature": "X", "proto": "TCP", "action": "unknown"})
        assert result["suggested_action"] is None
        assert "unknown" in result["recommendation"]


# --------------------------------------------------------------------------
# storage plumbing
# --------------------------------------------------------------------------
class TestEventStoreAndAudit:
    def test_store_merges_sources_without_hiding_them(self, tmp_path: Path):
        live = tmp_path / "live.json"
        live.write_text(
            '{"timestamp":"2026-01-02T00:00:00.000000+0000","event_type":"alert",'
            '"src_ip":"10.0.0.1","alert":{"signature":"LIVE","signature_id":9,"action":"allowed"}}\n',
            encoding="utf-8",
        )
        settings = Settings()
        from dataclasses import replace

        settings = replace(settings, live_eve_path=live)
        store = EventStore(settings)
        store.reload_settings(settings)
        events = store.all_events(force=True)
        sources = {e["source"] for e in events}
        assert "live" in sources and "historical" in sources
        assert store.snapshot().counts()["live"] == 1

    def test_audit_note_and_status_round_trip(self, tmp_path: Path):
        store = AuditStore(tmp_path / "audit.sqlite3")
        store.add_note("evt123", "Investigating the ICMP test", "analyst-a", "investigating")
        notes = store.notes_for("evt123")
        assert len(notes) == 1 and notes[0]["author"] == "analyst-a"
        assert store.state_map()["evt123"]["status"] == "investigating"
        assert store.audit_log()[0]["kind"] == "analyst_note"

    def test_rejects_invalid_status(self, tmp_path: Path):
        store = AuditStore(tmp_path / "audit.sqlite3")
        with pytest.raises(ValueError):
            store.set_status("evt123", "definitely-not-a-status")


def test_openapi_contract_is_served(client: TestClient):
    spec = client.get("/openapi.json").json()
    for route in (
        "/api/health", "/api/alerts", "/api/stats",
        "/api/network/status", "/api/system/status", "/api/response/actions",
    ):
        assert route in spec["paths"], f"{route} missing from the OpenAPI contract"
