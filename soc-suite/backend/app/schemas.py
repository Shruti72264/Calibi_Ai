"""Pydantic response/request models = the API contract the dashboard codes against."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

Action = Literal["allowed", "blocked", "unknown"]
Severity = Literal["high", "medium", "low", "unknown"]
Source = Literal["live", "historical"]


# --------------------------------------------------------------------------
# events
# --------------------------------------------------------------------------
class Event(BaseModel):
    event_id: str
    source: Source
    source_file: str
    event_kind: str = "suricata-eve"
    timestamp: str | None = None
    timestamp_raw: str | None = None
    flow_id: int | str | None = None
    event_type: str = "alert"
    src_ip: str | None = None
    src_port: int | None = None
    dest_ip: str | None = None
    dest_port: int | None = None
    proto: str = "unknown"
    app_proto: str | None = None
    signature: str
    rule_id: int | str | None = None
    gid: int | str | None = None
    rev: int | str | None = None
    category: str | None = None
    severity: Severity = "unknown"
    action: Action = "unknown"
    action_source: str = "not recorded in the EVE event"
    action_raw: str | None = None
    host: str | None = None
    interface: str | None = None
    community_id: str | None = None
    flow: dict[str, Any] | None = None
    packet_info: dict[str, Any] | None = None
    payload_printable: str | None = None
    pcap_file: str | None = None
    is_custom_rule: bool = False
    raw_excerpt: dict[str, Any] = Field(default_factory=dict)
    # analyst layer, joined from the audit store
    analyst_status: Literal["new", "investigating", "resolved", "false_positive"] = "new"
    analyst_note_count: int = 0


class AlertListResponse(BaseModel):
    items: list[Event]
    total: int
    page: int
    page_size: int
    pages: int
    sort: str
    order: str
    counts_by_source: dict[str, int]
    applied_filters: dict[str, Any]
    generated_at: str


class RelatedEvents(BaseModel):
    by_flow_id: list[Event] = Field(default_factory=list)
    by_source_ip: list[Event] = Field(default_factory=list)
    by_destination_ip: list[Event] = Field(default_factory=list)
    by_signature: list[Event] = Field(default_factory=list)


class EventDetail(BaseModel):
    event: Event
    related: RelatedEvents
    timeline: list[dict[str, Any]]
    notes: list[dict[str, Any]]
    response_recommendation: dict[str, Any]


class NoteCreate(BaseModel):
    note: str = Field(min_length=2, max_length=2000)
    author: str = Field(default="analyst", max_length=80)
    status: Literal["new", "investigating", "resolved", "false_positive"] | None = None


# --------------------------------------------------------------------------
# stats / health
# --------------------------------------------------------------------------
class Distribution(BaseModel):
    key: str
    count: int
    percent: float


class StatsResponse(BaseModel):
    generated_at: str
    window: dict[str, Any]
    totals: dict[str, int]
    counts_by_source: dict[str, int]
    severity_distribution: list[Distribution]
    protocol_distribution: list[Distribution]
    action_distribution: list[Distribution]
    event_type_distribution: list[Distribution]
    top_signatures: list[Distribution]
    top_source_ips: list[Distribution]
    top_destination_ips: list[Distribution]
    timeline: list[dict[str, Any]]
    custom_rule_events: int
    analyst_status_distribution: list[Distribution]


class SourceHealth(BaseModel):
    source: str
    enabled: bool
    state: str
    detail: str
    configured_paths: list[str]
    events_available: int
    files: list[dict[str, Any]]


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    service: str
    version: str
    env: str
    uptime_seconds: float
    server_time: str
    data_sources: list[SourceHealth]
    events_available: int
    counts_by_source: dict[str, int]
    cache_age_seconds: float
    reads_ok: bool


class SuricataStatus(BaseModel):
    checked_at: str
    checked: bool
    note: str
    version: str | None = None
    binary_present: bool = False
    binary_path: str | None = None
    service_state: str = "unknown"
    service_probe: str = ""
    process_count: int | None = None
    eve_file: dict[str, Any] = Field(default_factory=dict)
    fast_log: dict[str, Any] = Field(default_factory=dict)
    stats_log: dict[str, Any] = Field(default_factory=dict)
    rule_files_visible: list[dict[str, Any]] = Field(default_factory=list)
    interpretation: str = ""


class SystemStatusResponse(BaseModel):
    generated_at: str
    backend: dict[str, Any]
    config: dict[str, Any]
    suricata: SuricataStatus
    data_sources: list[SourceHealth]
    files: list[dict[str, Any]]
    cisco: dict[str, Any]
    response: dict[str, Any]


# --------------------------------------------------------------------------
# network / cisco
# --------------------------------------------------------------------------
class DeviceOut(BaseModel):
    id: str
    name: str
    kind: str
    site: str
    tier: str
    evidence_status: Literal["verified", "simulated", "unknown", "unavailable"]
    evidence_note: str | None = None
    addresses: list[dict[str, Any]] = Field(default_factory=list)
    services: list[str] = Field(default_factory=list)
    evidence_refs: list[str] = Field(default_factory=list)


class LinkOut(BaseModel):
    id: str
    a: str
    b: str
    medium: str
    status: Literal["verified", "simulated", "unknown", "unavailable"]
    evidence_note: str | None = None
    addresses: list[str] = Field(default_factory=list)


class EvidenceItem(BaseModel):
    id: str
    area: str
    title: str
    result: str
    verified_at: str | None = None
    source: str
    status: Literal["verified", "simulated", "unknown", "unavailable"]
    detail: str | None = None
    command: str | None = None
    expected: str | None = None
    observed: str | None = None


class NetworkStatusResponse(BaseModel):
    generated_at: str
    provider: str
    provider_mode: Literal["evidence", "live", "hybrid"]
    data_class: str
    disclosure: str
    evidence_pack: dict[str, Any]
    sites: list[dict[str, Any]]
    devices: list[DeviceOut]
    links: list[LinkOut]
    evidence: list[EvidenceItem]
    live_collection: dict[str, Any]


# --------------------------------------------------------------------------
# response workflow
# --------------------------------------------------------------------------
class ResponseActionRequest(BaseModel):
    event_id: str = Field(min_length=4, max_length=64)
    action_type: Literal["block_source_ip", "unblock_source_ip", "quarantine_flow"]
    target_ip: str | None = Field(default=None, max_length=64)
    reason: str = Field(min_length=4, max_length=500)
    confirm: bool = False
    authorization: str = Field(
        default="",
        max_length=200,
        description="Free-text statement that you are authorised to act on this lab target.",
    )


class ResponseActionResponse(BaseModel):
    accepted: bool
    executed: bool
    mode: str
    action_type: str
    target_ip: str | None
    event_id: str
    audit_id: int
    plan: dict[str, Any]
    message: str
    warnings: list[str] = Field(default_factory=list)


class AuditEntry(BaseModel):
    id: int
    created_at: str
    actor: str
    kind: str
    event_id: str | None = None
    action_type: str | None = None
    target: str | None = None
    status: str
    mode: str | None = None
    detail: str | None = None
    rollback: str | None = None
    result: str | None = None
