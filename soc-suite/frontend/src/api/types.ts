/**
 * TypeScript mirror of the FastAPI Pydantic schemas.
 *
 * If the backend schema changes, change it here in the same commit: the
 * dashboard must never render a field it merely *hopes* exists.
 */

export type DataSource = 'live' | 'historical';
export type Action = 'allowed' | 'blocked' | 'unknown';
export type Severity = 'high' | 'medium' | 'low' | 'unknown';
export type EvidenceStatus = 'verified' | 'simulated' | 'unknown' | 'unavailable';
export type AnalystStatus = 'new' | 'investigating' | 'resolved' | 'false_positive';

export interface SocEvent {
  event_id: string;
  source: DataSource;
  source_file: string;
  event_kind: string;
  timestamp: string | null;
  timestamp_raw: string | null;
  flow_id: number | string | null;
  event_type: string;
  src_ip: string | null;
  src_port: number | null;
  dest_ip: string | null;
  dest_port: number | null;
  proto: string;
  app_proto: string | null;
  signature: string;
  rule_id: number | string | null;
  gid: number | string | null;
  rev: number | string | null;
  category: string | null;
  severity: Severity;
  action: Action;
  action_source: string;
  action_raw: string | null;
  host: string | null;
  interface: string | null;
  community_id: string | null;
  flow: Record<string, unknown> | null;
  packet_info: Record<string, unknown> | null;
  payload_printable: string | null;
  pcap_file: string | null;
  is_custom_rule: boolean;
  raw_excerpt: Record<string, unknown>;
  analyst_status: AnalystStatus;
  analyst_note_count: number;
}

export interface CountsBySource {
  live: number;
  historical: number;
  returned?: number;
}

export interface AlertListResponse {
  items: SocEvent[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  sort: string;
  order: string;
  counts_by_source: CountsBySource;
  applied_filters: Record<string, unknown>;
  generated_at: string;
}

export interface TimelineNode {
  timestamp: string | null;
  kind: 'focal' | 'correlated';
  label: string;
  detail: string;
  event_id: string;
  correlation: string;
}

export interface Recommendation {
  category: string;
  technique: string;
  priority: 'P1' | 'P2' | 'P3';
  recommendation: string;
  suggested_action: string | null;
  basis: Record<string, unknown>;
}

export interface EventDetail {
  event: SocEvent;
  related: {
    by_flow_id: SocEvent[];
    by_source_ip: SocEvent[];
    by_destination_ip: SocEvent[];
    by_signature: SocEvent[];
  };
  timeline: TimelineNode[];
  notes: AnalystNote[];
  response_recommendation: Recommendation;
}

export interface AnalystNote {
  id: number;
  event_id: string;
  created_at: string;
  author: string;
  note: string;
  status: string | null;
}

export interface Distribution {
  key: string;
  count: number;
  percent: number;
}

export interface StatsResponse {
  generated_at: string;
  window: {
    requested: string;
    source_filter: string;
    since: string | null;
    bucket: string;
    events_considered: number;
  };
  totals: {
    events: number;
    blocked: number;
    allowed: number;
    unknown_action: number;
    high_severity: number;
    custom_rules: number;
    unique_source_ips: number;
    unique_signatures: number;
    triaged: number;
  };
  counts_by_source: { live: number; historical: number };
  severity_distribution: Distribution[];
  protocol_distribution: Distribution[];
  action_distribution: Distribution[];
  event_type_distribution: Distribution[];
  top_signatures: Distribution[];
  top_source_ips: Distribution[];
  top_destination_ips: Distribution[];
  timeline: { bucket: string; total: number; blocked: number; allowed: number; unknown: number }[];
  custom_rule_events: number;
  analyst_status_distribution: Distribution[];
}

export interface SourceFileFacts {
  path: string;
  exists: boolean;
  readable: boolean;
  size_bytes: number | null;
  modified_at: string | null;
  lines_total: number;
  lines_invalid: number;
  lines_trailing_partial?: number;
  error: string | null;
}

export interface SourceHealth {
  source: DataSource;
  enabled: boolean;
  state: 'ok' | 'empty' | 'missing' | 'unreadable' | 'disabled' | 'error' | 'unknown';
  detail: string;
  configured_paths: string[];
  events_available: number;
  files: SourceFileFacts[];
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  env: string;
  uptime_seconds: number;
  server_time: string;
  data_sources: SourceHealth[];
  events_available: number;
  counts_by_source: { live: number; historical: number; total: number };
  cache_age_seconds: number;
  reads_ok: boolean;
}

export interface SuricataStatus {
  checked_at: string;
  checked: boolean;
  note: string;
  version: string | null;
  binary_present: boolean;
  binary_path: string | null;
  service_state: string;
  service_probe: string;
  process_count: number | null;
  eve_file: Record<string, unknown>;
  fast_log: Record<string, unknown>;
  stats_log: Record<string, unknown>;
  rule_files_visible: { path: string; size_bytes: number; modified_at: string; readable: boolean }[];
  interpretation: string;
}

export interface SystemStatus {
  generated_at: string;
  backend: {
    service: string;
    version: string;
    env: string;
    uptime_seconds: number;
    server_time: string;
    write_protection: {
      writes_enabled: boolean;
      api_key_configured: boolean;
      allow_writes: boolean;
    };
    audit_store: { available: boolean; path: string; notes?: number; audit_entries?: number; error: string | null };
  };
  config: Record<string, unknown>;
  suricata: SuricataStatus;
  data_sources: SourceHealth[];
  files: { source: DataSource; path: string; exists: boolean; readable: boolean; size_bytes: number | null; modified_at: string | null; error: string | null }[];
  cisco: {
    provider: string;
    provider_mode: 'evidence' | 'live' | 'hybrid';
    data_class: string;
    evidence_pack_available: boolean;
    devices_total: number;
    devices_by_evidence_status: Record<string, number>;
    links_total: number;
    evidence_items: number;
    live_collection: LiveCollection;
  };
  response: ResponseStatus;
}

export interface LiveCollection {
  enabled: boolean;
  supported_by_devices: boolean;
  adapter: string;
  probes: { target: string; host: string; port: number; reachable: boolean; error: string | null; checked_at: string }[];
  note: string;
  checked_at: string;
}

export interface NetworkDevice {
  id: string;
  name: string;
  kind: string;
  site: string;
  tier: string;
  evidence_status: EvidenceStatus;
  evidence_note: string | null;
  addresses: { interface: string; ip: string; mask?: string; role: string; gateway?: string }[];
  services: string[];
  evidence_refs: string[];
}

export interface NetworkLink {
  id: string;
  a: string;
  b: string;
  medium: string;
  status: EvidenceStatus;
  evidence_note?: string;
  addresses: string[];
}

export interface EvidenceItem {
  id: string;
  area: string;
  title: string;
  result: string;
  verified_at: string | null;
  verified_at_note?: string;
  source: string;
  status: EvidenceStatus;
  detail: string;
  command?: string;
  expected?: string;
  observed?: string;
}

export interface NetworkStatus {
  generated_at: string;
  provider: string;
  provider_mode: 'evidence' | 'live' | 'hybrid';
  data_class: string;
  disclosure: string;
  evidence_pack: {
    available: boolean;
    error?: string;
    pack_id?: string;
    title?: string;
    source_system?: string;
    version?: string;
    generated_at?: string | null;
    generated_at_note?: string;
    path?: string;
    addressing_plan?: { segment: string; cidr: string; note: string }[];
  };
  sites: { id: string; name: string; role: string }[];
  devices: NetworkDevice[];
  links: NetworkLink[];
  evidence: EvidenceItem[];
  live_collection: LiveCollection;
}

export interface ResponseStatus {
  mode: 'recommend' | 'dry_run' | 'enforce';
  valid_modes: string[];
  secure_default: string;
  allowlist: string[];
  allowlist_configured: boolean;
  local_firewall_backend: string;
  max_actions_per_hour: number;
  recent_executed_actions: number;
  dry_run_supported: boolean;
  capabilities: string[];
  explicitly_out_of_scope: string[];
}

export interface ResponseActionResult {
  accepted: boolean;
  executed: boolean;
  mode: string;
  action_type: string;
  target_ip: string | null;
  event_id: string;
  audit_id: number;
  plan: {
    feasible: boolean;
    summary: string;
    blockers: string[];
    warnings: string[];
    executor: string;
    command_preview: string | null;
    rollback_preview: string | null;
  };
  message: string;
  warnings: string[];
}

export interface AuditEntry {
  id: number;
  created_at: string;
  actor: string;
  kind: string;
  event_id: string | null;
  action_type: string | null;
  target: string | null;
  status: string;
  mode: string | null;
  detail: string | null;
  rollback: string | null;
  result: string | null;
}

export interface ApiErrorBody {
  error: true;
  status: number;
  detail: string;
  path: string;
  timestamp: string;
}
