/**
 * Overview - the "walk in and know the state of the estate in ten seconds" page.
 *
 * Every number is traceable: alerts come from /api/stats, source health from
 * /api/health, and the recent-events table from /api/alerts. Live and historical
 * counts are never summed into a single headline figure without saying so.
 */

import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useSoc } from '../context/SocContext';
import { formatTimestamp, portLabel, relativeTime } from '../lib/format';
import {
  ActionBadge,
  ActionDonut,
  Bars,
  DataSourceStrip,
  ErrorState,
  EvidenceBadge,
  IconAlert,
  IconInfo,
  IconRefresh,
  LastUpdated,
  LoadingState,
  Panel,
  Pill,
  SeverityBadge,
  SeverityDonut,
  SourceBadge,
  StatCard,
  TimelineChart,
} from '../components/ui';

export default function Overview() {
  const soc = useSoc();
  const stats = useApi(
    ({ signal }) => api.stats(soc.window, 'all', { signal }),
    [soc.window],
    { intervalMs: soc.intervalMs },
  );
  const recent = useApi(
    ({ signal }) => api.alerts({ page: 1, page_size: 8, sort: 'timestamp', order: 'desc', window: soc.window }, { signal }),
    [soc.window],
    { intervalMs: soc.intervalMs },
  );

  const health = soc.health.data;
  const counts = health?.counts_by_source;
  const liveState = health?.data_sources.find((s) => s.source === 'live')?.state ?? 'unknown';
  const historicalState = health?.data_sources.find((s) => s.source === 'historical')?.state ?? 'unknown';
  const totals = stats.data?.totals;

  return (
    <>
      {health && (
        <DataSourceStrip
          live={counts?.live ?? 0}
          historical={counts?.historical ?? 0}
          liveState={liveState}
          historicalState={historicalState}
        />
      )}

      <div className="grid stats">
        <StatCard
          label="Total alerts in scope"
          value={totals ? totals.events : '—'}
          foot={stats.data ? `window: ${stats.data.window.requested} · bucket: ${stats.data.window.bucket}` : 'loading'}
        />
        <StatCard
          label="Blocked events"
          value={totals ? totals.blocked : '—'}
          tone="danger"
          foot="IPS drop / alert action = blocked"
        />
        <StatCard
          label="Allowed events"
          value={totals ? totals.allowed : '—'}
          tone="ok"
          foot="Detected, traffic permitted"
        />
        <StatCard
          label="High severity"
          value={totals ? totals.high_severity : '—'}
          tone={totals && totals.high_severity > 0 ? 'danger' : ''}
          foot="Suricata severity 1"
        />
        <StatCard
          label="Unknown verdict"
          value={totals ? totals.unknown_action : '—'}
          tone={totals && totals.unknown_action > 0 ? 'warn' : ''}
          foot="EVE record did not state an action"
        />
        <StatCard
          label="Custom rule hits"
          value={totals ? totals.custom_rules : '—'}
          foot="rule ids ≥ 1000000 (local.rules)"
        />
        <StatCard
          label="Distinct sources"
          value={totals ? totals.unique_source_ips : '—'}
          foot={totals ? `${totals.unique_signatures} distinct signature(s)` : ''}
        />
        <StatCard
          label="Triaged by analyst"
          value={totals ? totals.triaged : '—'}
          foot="events with a status recorded"
        />
      </div>

      <div className="grid split">
        <Panel
          title="Alert volume over time"
          subtitle="Bucket size is chosen from the selected window"
          actions={<LastUpdated at={stats.lastUpdated} />}
        >
          {stats.loading && !stats.data ? (
            <LoadingState rows={3} label="loading statistics…" />
          ) : stats.error && !stats.data ? (
            <ErrorState detail={stats.error.message} onRetry={stats.refresh} />
          ) : (
            <TimelineChart data={stats.data?.timeline ?? []} />
          )}
        </Panel>

        <Panel title="Alert severity distribution" subtitle="Suricata severity mapped to high / medium / low">
          {stats.data ? (
            <SeverityDonut data={stats.data.severity_distribution} />
          ) : (
            <LoadingState rows={2} />
          )}
        </Panel>
      </div>

      <div className="grid cols-3">
        <Panel title="Recorded action" subtitle="What the sensor actually did with each matching flow">
          {stats.data ? <ActionDonut data={stats.data.action_distribution} size={124} /> : <LoadingState rows={2} />}
        </Panel>

        <Panel title="Events by protocol" subtitle="Top protocols observed in scope">
          {stats.data ? (
            <Bars data={stats.data.protocol_distribution} tone="info" limit={8} />
          ) : (
            <LoadingState rows={3} />
          )}
        </Panel>

        <Panel title="Top signatures" subtitle="Detection rules with the most hits">
          {stats.data ? (
            <Bars data={stats.data.top_signatures} tone="warn" limit={6} />
          ) : (
            <LoadingState rows={3} />
          )}
        </Panel>

        <Panel title="Top source addresses" subtitle="Where the traffic came from">
          {stats.data ? <Bars data={stats.data.top_source_ips} tone="danger" limit={6} /> : <LoadingState rows={3} />}
        </Panel>

        <Panel title="Top destination addresses" subtitle="What was targeted">
          {stats.data ? <Bars data={stats.data.top_destination_ips} tone="ok" limit={6} /> : <LoadingState rows={3} />}
        </Panel>

        <Panel title="Analyst triage state" subtitle="Events an analyst has touched">
          {stats.data ? (
            stats.data.totals.triaged === 0 ? (
              <div className="panel-sub">
                No events have been triaged yet. Open an event under{' '}
                <Link to="/investigation" style={{ color: '#7dd3fc' }}>
                  Event Investigation
                </Link>{' '}
                to record a status or a note.
              </div>
            ) : (
              <Bars data={stats.data.analyst_status_distribution} tone="ok" />
            )
          ) : (
            <LoadingState rows={2} />
          )}
        </Panel>
      </div>

      <Panel
        title="Recent events"
        subtitle="Newest first, from both sources"
        flush
        actions={
          <>
            <Pill tone="accent">{recent.data?.counts_by_source.live ?? 0} live</Pill>
            <Pill tone="info">{recent.data?.counts_by_source.historical ?? 0} historical</Pill>
            <Link to="/alerts" className="btn small">
              Open alerts console
            </Link>
          </>
        }
      >
        {recent.loading && !recent.data ? (
          <div style={{ padding: 15 }}>
            <LoadingState rows={4} />
          </div>
        ) : recent.error && !recent.data ? (
          <ErrorState detail={recent.error.message} onRetry={recent.refresh} />
        ) : (recent.data?.items.length ?? 0) === 0 ? (
          <div style={{ padding: 15 }}>
            <ErrorState
              title="No events in the selected window"
              detail={
                <>
                  Suricata has not produced a matching alert in this window. Check{' '}
                  <Link to="/system" style={{ color: '#7dd3fc' }}>
                    System Health
                  </Link>{' '}
                  for the EVE file path, its size and the sensor state.
                </>
              }
              onRetry={recent.refresh}
            />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Source</th>
                  <th>Severity</th>
                  <th>Action</th>
                  <th>Signature</th>
                  <th>Flow</th>
                  <th>Rule</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recent.data?.items.map((event) => (
                  <tr key={event.event_id}>
                    <td className="mono nowrap">{formatTimestamp(event.timestamp)}</td>
                    <td>
                      <SourceBadge source={event.source} />
                    </td>
                    <td>
                      <SeverityBadge severity={event.severity} />
                    </td>
                    <td>
                      <ActionBadge action={event.action} />
                    </td>
                    <td className="signature-cell">
                      <span className="cell-strong">{event.signature}</span>
                      {event.is_custom_rule && (
                        <span className="tag" style={{ marginLeft: 6 }}>
                          local rule
                        </span>
                      )}
                    </td>
                    <td className="mono nowrap">
                      {portLabel(event.src_ip, event.src_port)} → {portLabel(event.dest_ip, event.dest_port)}
                      <div className="faint small">{event.proto}</div>
                    </td>
                    <td className="mono">{event.rule_id ?? '—'}</td>
                    <td>
                      <Link to={`/investigation/${encodeURIComponent(event.event_id)}`} className="btn small">
                        Investigate
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid cols-3">
        <Panel title="Cisco network evidence" subtitle="Simulation data — never presented as live telemetry">
          {soc.system.data ? (
            <div className="grid" style={{ gap: 10 }}>
              <div className="grid cols-2" style={{ gap: 10 }}>
                <StatCard
                  label="Devices documented"
                  value={soc.system.data.cisco.devices_total}
                  small
                  foot={`${soc.system.data.cisco.links_total} links · ${soc.system.data.cisco.evidence_items} evidence items`}
                />
                <StatCard
                  label="Live collection"
                  value={soc.system.data.cisco.live_collection.enabled ? 'enabled' : 'off'}
                  small
                  tone="warn"
                  foot="Packet Tracer exposes no telemetry"
                />
              </div>
              <div className="panel-sub">
                {Object.entries(soc.system.data.cisco.devices_by_evidence_status).map(([status, count]) => (
                  <span key={status} style={{ marginRight: 10 }}>
                    <EvidenceBadge status={status as 'verified' | 'simulated' | 'unknown' | 'unavailable'} /> × {count}
                  </span>
                ))}
              </div>
              <Link to="/topology" className="btn small">
                View topology and evidence
              </Link>
            </div>
          ) : (
            <LoadingState rows={3} />
          )}
        </Panel>

        <Panel title="Sensor & data pipeline" subtitle="What is feeding this dashboard right now">
          <div className="grid" style={{ gap: 9 }}>
            {health?.data_sources.map((source) => (
              <div className="notice" key={source.source}>
                <span className="notice-icon">
                  <IconAlert size={14} />
                </span>
                <div>
                  <div className="notice-title">
                    {source.source === 'live' ? 'Live EVE source' : 'Historical evidence source'} —{' '}
                    <span className="mono">{source.state}</span>
                  </div>
                  <div className="small dim">{source.detail}</div>
                  <div className="small faint mono">{source.configured_paths[0]}</div>
                </div>
              </div>
            ))}
            <div className="panel-sub">
              Last successful read: {relativeTime(soc.health.lastUpdated)} · cache age{' '}
              {health ? `${health.cache_age_seconds}s` : '—'}
            </div>
          </div>
        </Panel>

        <Panel title="How to read this dashboard" subtitle="Data-class rules enforced by the API">
          <ul className="list">
            <li>
              <strong>Live</strong> rows come from the sensor's current EVE file, read on this request. If that file were
              empty you would see zero live events — never a substitute.
            </li>
            <li>
              <strong>Historical evidence</strong> rows are replayed from the baseline file and keep their original
              timestamps, so they can never be mistaken for current traffic.
            </li>
            <li>
              <strong>Action</strong> is only ever taken from the EVE record itself; when Suricata did not write a
              verdict, the dashboard says <span className="mono">unknown</span>.
            </li>
            <li>
              Cisco device data is <strong>simulation evidence</strong> captured from CLI verification. Packet Tracer
              traffic is not visible to Suricata, and this UI never implies otherwise.
            </li>
          </ul>
          <div className="notice info" style={{ marginTop: 10 }}>
            <span className="notice-icon">
              <IconInfo size={14} />
            </span>
            <div>
              A dashboard status change is <strong>not</strong> a network block. Only an executed response action
              (audited under Response &amp; Audit) changes anything, and only on allow-listed targets.
            </div>
          </div>
        </Panel>
      </div>

      <div className="panel-sub faint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <IconRefresh size={13} />
        Auto-refresh every {soc.intervalMs === 0 ? '— (off)' : `${soc.intervalMs / 1000}s`}. Statistics recompute on every
        poll; no client-side aggregation is used.
      </div>
    </>
  );
}
