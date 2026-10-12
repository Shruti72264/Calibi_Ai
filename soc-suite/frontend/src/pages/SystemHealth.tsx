/**
 * System Health.
 *
 * The page an operator opens when something looks wrong. It answers, in order:
 *   is the API up? → which data sources exist and what state are they in? →
 *   where exactly does each file live and how big is it? → is the sensor
 *   running? → is the dashboard allowed to write?
 *
 * When the backend is unreachable this page still renders, with the last known
 * snapshot and an explicit stale marker.
 */

import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useSoc } from '../context/SocContext';
import { formatBytes, formatDuration, formatTimestamp, relativeTime } from '../lib/format';
import {
  ErrorState,
  IconActivity,
  IconInfo,
  IconWarning,
  KeyValue,
  LoadingState,
  Notice,
  Panel,
  Pill,
  StatCard,
} from '../components/ui';

const SOURCE_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'info' | ''> = {
  ok: 'ok',
  empty: 'warn',
  missing: 'danger',
  unreadable: 'danger',
  disabled: '',
  error: 'danger',
  unknown: 'warn',
};

export default function SystemHealth() {
  const soc = useSoc();
  const system = useApi(({ signal }) => api.system({ signal }), [], { intervalMs: 30000 });
  const health = soc.health;
  const data = system.data;

  const reachable = soc.backendReachable;
  const stale = Boolean(soc.connectionError && data);

  return (
    <>
      {!reachable && (
        <Notice tone="danger" title="Backend unreachable right now">
          {soc.connectionError?.message}
          {data && (
            <div className="small" style={{ marginTop: 6 }}>
              The snapshot below was captured {relativeTime(soc.system.lastUpdated)} and is shown so you can compare it with
              what the API reported when it was last reachable. It is not current.
            </div>
          )}
        </Notice>
      )}

      {stale && reachable && (
        <Notice tone="warn" title="Showing the last successful read">
          A later poll failed, so some values may lag. Last good update {relativeTime(soc.system.lastUpdated)}.
        </Notice>
      )}

      <div className="grid stats">
        <StatCard
          label="Backend health"
          value={health.data?.status ?? (reachable ? '…' : 'unreachable')}
          small
          tone={health.data?.status === 'ok' ? 'ok' : health.data?.status === 'degraded' ? 'warn' : 'danger'}
          foot={health.data ? `API v${health.data.version} · ${health.data.env}` : 'no response'}
        />
        <StatCard
          label="API uptime"
          value={formatDuration(health.data?.uptime_seconds ?? null)}
          small
          foot={health.data ? `server time ${health.data.server_time.slice(11, 19)}Z` : '—'}
        />
        <StatCard
          label="Events available"
          value={health.data?.events_available ?? '—'}
          foot={
            health.data
              ? `${health.data.counts_by_source.live} live · ${health.data.counts_by_source.historical} historical`
              : '—'
          }
        />
        <StatCard
          label="Last data refresh"
          value={relativeTime(health.lastUpdated)}
          small
          foot={`cache age ${health.data?.cache_age_seconds ?? '—'}s · poll ${soc.intervalMs ? `${soc.intervalMs / 1000}s` : 'off'}`}
        />
        <StatCard
          label="Write protection"
          value={data?.backend.write_protection.writes_enabled ? 'open' : 'closed'}
          small
          tone={data?.backend.write_protection.writes_enabled ? 'warn' : 'ok'}
          foot="mutating routes need SOC_API_KEY + SOC_ALLOW_WRITES"
        />
        <StatCard
          label="Audit database"
          value={data?.backend.audit_store.available ? 'available' : 'unavailable'}
          small
          tone={data?.backend.audit_store.available ? 'ok' : 'danger'}
          foot={data ? `${data.backend.audit_store.notes ?? 0} note(s) · ${data.backend.audit_store.audit_entries ?? 0} audit entr(ies)` : '—'}
        />
      </div>

      <Panel
        title="Data sources"
        subtitle="Each source is reported independently — a broken live feed never hides healthy evidence"
        actions={
          <>
            <Pill tone={reachable ? 'ok' : 'danger'} dot>
              {reachable ? 'API reachable' : 'API offline'}
            </Pill>
            <button type="button" className="btn small" onClick={() => { health.refresh(); system.refresh(); }} disabled={health.refreshing}>
              {health.refreshing ? 'Re-reading…' : 'Re-read sources'}
            </button>
          </>
        }
      >
        {health.loading && !health.data ? (
          <LoadingState rows={4} label="reading data-source state…" />
        ) : health.error && !health.data ? (
          <ErrorState
            title="Cannot determine data-source state"
            detail={health.error.message}
            onRetry={health.refresh}
            meta="Without a response from /api/health the dashboard will not guess at source health."
          />
        ) : (
          <div className="grid cols-2">
            {health.data?.data_sources.map((source) => (
              <div className="panel" key={source.source} style={{ background: 'var(--bg-panel-2)' }}>
                <div className="panel-head">
                  <div>
                    <h3>{source.source === 'live' ? 'Live sensor telemetry' : 'Historical baseline evidence'}</h3>
                    <div className="panel-sub">{source.enabled ? 'enabled' : 'disabled by configuration'}</div>
                  </div>
                  <div className="panel-actions">
                    <Pill tone={SOURCE_TONE[source.state] ?? ''}>{source.state}</Pill>
                    <Pill tone="info">{source.events_available} event(s)</Pill>
                  </div>
                </div>
                <div className="panel-body">
                  <div className="small" style={{ marginBottom: 10 }}>
                    {source.detail}
                  </div>
                  <div className="kv-key" style={{ marginBottom: 4 }}>
                    Configured path(s)
                  </div>
                  <div className="mono small" style={{ marginBottom: 10 }}>
                    {source.configured_paths.map((path) => (
                      <div key={path}>{path}</div>
                    ))}
                  </div>
                  {source.files.length > 0 && (
                    <div className="table-wrap">
                      <table className="data">
                        <thead>
                          <tr>
                            <th>File</th>
                            <th className="num">Size</th>
                            <th className="num">Lines</th>
                            <th>Modified</th>
                            <th>Error</th>
                          </tr>
                        </thead>
                        <tbody>
                          {source.files.map((file) => (
                            <tr key={file.path}>
                              <td className="mono small">{file.path.split('/').slice(-1)[0]}</td>
                              <td className="num">{formatBytes(file.size_bytes)}</td>
                              <td className="num">
                                {file.lines_total}
                                {file.lines_invalid > 0 && (
                                  <span className="faint" title="unparseable lines skipped">
                                    {' '}
                                    ({file.lines_invalid} bad)
                                  </span>
                                )}
                              </td>
                              <td className="mono small faint">{file.modified_at ? formatTimestamp(file.modified_at) : '—'}</td>
                              <td className="small" style={{ color: file.error ? 'var(--warn)' : 'inherit' }}>
                                {file.error ?? 'none'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid split">
        <Panel title="File-level probes" subtitle="Sizes and timestamps as the API sees them (no content is read here)">
          {data ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Path</th>
                    <th>Exists</th>
                    <th>Readable</th>
                    <th className="num">Size</th>
                    <th>Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {data.files.map((file) => (
                    <tr key={`${file.source}-${file.path}`}>
                      <td>
                        <Pill tone={file.source === 'live' ? 'info' : 'accent'}>{file.source}</Pill>
                      </td>
                      <td className="mono small">{file.path}</td>
                      <td>{file.exists ? <Pill tone="ok">yes</Pill> : <Pill tone="danger">no</Pill>}</td>
                      <td>{file.readable ? <Pill tone="ok">yes</Pill> : <Pill tone="warn">no</Pill>}</td>
                      <td className="num">{formatBytes(file.size_bytes)}</td>
                      <td className="mono small faint">{file.modified_at ? formatTimestamp(file.modified_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <LoadingState rows={3} />
          )}
        </Panel>

        <div className="grid" style={{ gap: 14, alignContent: 'start' }}>
          <Panel title="Suricata probe" subtitle="Read-only checks executed on the API host">
            {data ? (
              <KeyValue
                rows={[
                  { key: 'Checked at', value: <span className="mono">{formatTimestamp(data.suricata.checked_at)}</span> },
                  {
                    key: 'Binary',
                    value: data.suricata.binary_present ? (
                      <span className="mono small">{data.suricata.binary_path}</span>
                    ) : (
                      <span className="faint">not found on this host</span>
                    ),
                  },
                  { key: 'Version', value: <span className="mono">{data.suricata.version ?? '—'}</span> },
                  { key: 'Service state', value: <span className="mono">{data.suricata.service_state}</span> },
                  { key: 'Probe', value: <span className="mono small">{data.suricata.service_probe || '—'}</span> },
                  {
                    key: 'Interpretation',
                    value: <span className="small">{data.suricata.interpretation || data.suricata.note || '—'}</span>,
                  },
                ]}
              />
            ) : (
              <LoadingState rows={3} />
            )}
            <div style={{ marginTop: 10 }}>
              <Link to="/ids-ips" className="btn small">
                <IconActivity size={13} /> Open IDS/IPS monitoring
              </Link>
            </div>
          </Panel>

          <Panel title="Backend configuration" subtitle="Non-secret settings the API is running with">
            {data ? (
              <div className="table-wrap">
                <table className="data">
                  <tbody>
                    {Object.entries(data.config).map(([key, value]) => (
                      <tr key={key}>
                        <td className="kv-key">{key}</td>
                        <td className="mono small">{Array.isArray(value) ? value.join(', ') || '—' : String(value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <LoadingState rows={4} />
            )}
          </Panel>

          <Panel title="Cisco provider" subtitle="What the network pages are actually reading">
            {data ? (
              <KeyValue
                rows={[
                  { key: 'Provider mode', value: <span className="mono">{data.cisco.provider_mode}</span> },
                  { key: 'Data class', value: <span className="mono">{data.cisco.data_class}</span> },
                  {
                    key: 'Evidence pack',
                    value: data.cisco.evidence_pack_available ? <Pill tone="ok">loaded</Pill> : <Pill tone="danger">missing</Pill>,
                  },
                  { key: 'Devices', value: `${data.cisco.devices_total} · ${data.cisco.links_total} link(s)` },
                  {
                    key: 'Live collection',
                    value: data.cisco.live_collection.enabled ? (
                      <Pill tone="warn">enabled</Pill>
                    ) : (
                      <Pill tone="info">off (evidence mode)</Pill>
                    ),
                  },
                  { key: 'Adapter note', value: <span className="small">{data.cisco.live_collection.note}</span> },
                ]}
              />
            ) : (
              <LoadingState rows={3} />
            )}
          </Panel>
        </div>
      </div>

      <Panel title="Error handling behaviour" subtitle="How this dashboard fails, so you can trust it when it succeeds">
        <div className="grid cols-2">
          <ul className="list">
            <li>
              <strong>Backend offline:</strong> a red banner appears in the topbar and each panel shows the API's own error
              message. Cached numbers are never silently displayed as current.
            </li>
            <li>
              <strong>Empty log file:</strong> the source reports <span className="mono">empty</span> with its byte count, and
              the event lists show zero — not sample data.
            </li>
            <li>
              <strong>Permission denied:</strong> the source reports{' '}
              <span className="mono">unreadable</span> and tells you to add the service account to the suricata group or point
              the API at a readable copy.
            </li>
            <li>
              <strong>Malformed JSON line:</strong> the parser skips the line, counts it, and reports the count next to the
              file; a truncated final line (the file is being written) is expected and does not raise.
            </li>
            <li>
              <strong>Unknown event id:</strong> a 404 with an explanation that logs rotate, instead of a blank detail page.
            </li>
            <li>
              <strong>Writes disabled:</strong> note and action endpoints return 403 and the UI explains how to enable them —
              no hidden fallback that pretends to save.
            </li>
          </ul>
          <div className="grid" style={{ gap: 10, alignContent: 'start' }}>
            <Notice tone="info" title="Refreshing the data">
              The API caches each read for a few seconds. Use <em>Re-read sources</em> above (or the topbar Refresh) to bypass
              the cache and re-read both files immediately — this never restarts Suricata.
            </Notice>
            <Notice tone="warn" title="Do not 'fix' a silent sensor here">
              If the live source is empty because Suricata is stopped, that is the correct report. Enabling the sensor is an
              operator decision documented on the IDS/IPS page, and it must be done with the traffic path and loaded rules
              understood first.
            </Notice>
            <div className="notice">
              <span className="notice-icon">
                <IconInfo size={14} />
              </span>
              <div>
                Useful commands for the API host:
                <pre className="code" style={{ marginTop: 8 }}>{`curl -s http://127.0.0.1:8000/api/health | python3 -m json.tool
curl -s http://127.0.0.1:8000/api/system/status | python3 -m json.tool
sudo ls -l /var/log/suricata/
sysctl net.ipv4.ip_forward   # only relevant if you enable IPS mode`}</pre>
              </div>
            </div>
            <div className="notice">
              <span className="notice-icon">
                <IconWarning size={14} />
              </span>
              <div>{data?.backend.audit_store.error ? `Audit store error: ${data.backend.audit_store.error}` : 'Audit store is healthy.'}</div>
            </div>
          </div>
        </div>
      </Panel>
    </>
  );
}
