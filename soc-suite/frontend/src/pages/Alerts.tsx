/**
 * Security Alerts - the working console.
 *
 * Filters map 1:1 onto documented API query parameters (docs/04_API.md), so what
 * you see here can be reproduced with curl. Filtering, sorting and pagination are
 * performed server-side; the browser never silently re-filters a partial page.
 */

import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type AlertQuery } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useSoc } from '../context/SocContext';
import { downloadCsv, formatTimestamp, portLabel, toCsv } from '../lib/format';
import type { SocEvent } from '../api/types';
import {
  ActionBadge,
  AnalystBadge,
  EmptyState,
  ErrorState,
  IconDownload,
  IconRefresh,
  IconSearch,
  LastUpdated,
  LoadingState,
  Panel,
  Pill,
  SeverityBadge,
  SourceBadge,
} from '../components/ui';

const SEVERITY_OPTIONS = ['high', 'medium', 'low', 'unknown'];
const ACTION_OPTIONS = ['blocked', 'allowed', 'unknown'];
const PAGE_SIZES = [10, 25, 50, 100];

const CSV_COLUMNS = [
  'timestamp', 'source', 'severity', 'action', 'action_source', 'proto', 'app_proto',
  'src_ip', 'src_port', 'dest_ip', 'dest_port', 'signature', 'rule_id', 'rev',
  'gid', 'category', 'event_type', 'flow_id', 'host', 'interface', 'analyst_status',
  'event_id',
];

export default function Alerts() {
  const soc = useSoc();
  const [draft, setDraft] = useState({ q: '', src_ip: '', dest_ip: '', signature: '', rule_id: '' });
  const [severity, setSeverity] = useState<string[]>([]);
  const [action, setAction] = useState<string[]>([]);
  const [proto, setProto] = useState('');
  const [source, setSource] = useState('all');
  const [sort, setSort] = useState('timestamp');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [expanded, setExpanded] = useState<string | null>(null);

  const query = useMemo<AlertQuery>(
    () => ({
      ...draft,
      severity: severity.length ? severity : undefined,
      action: action.length ? action : undefined,
      proto: proto || undefined,
      source,
      window: soc.window,
      sort,
      order,
      page,
      page_size: pageSize,
    }),
    [draft, severity, action, proto, source, sort, order, page, pageSize, soc.window],
  );

  const alerts = useApi(({ signal }) => api.alerts(query, { signal }), [JSON.stringify(query)], {
    intervalMs: soc.intervalMs,
  });

  const toggle = (list: string[], value: string, setter: (next: string[]) => void) => {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
    setPage(1);
  };

  const resetFilters = () => {
    setDraft({ q: '', src_ip: '', dest_ip: '', signature: '', rule_id: '' });
    setSeverity([]);
    setAction([]);
    setProto('');
    setSource('all');
    setPage(1);
  };

  const activeFilterCount =
    Object.values(draft).filter(Boolean).length + severity.length + action.length + (proto ? 1 : 0) + (source !== 'all' ? 1 : 0);

  const onSort = (column: string) => {
    if (sort === column) {
      setOrder(order === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(column);
      setOrder(column === 'timestamp' ? 'desc' : 'asc');
    }
  };

  const sortIndicator = (column: string) => (sort === column ? (order === 'asc' ? ' ▲' : ' ▼') : '');

  const data = alerts.data;
  const events: SocEvent[] = data?.items ?? [];

  return (
    <>
      <Panel
        title="Filters"
        subtitle="Every filter is applied by the API — reproduce any view with curl against /api/alerts"
        actions={
          <>
            {activeFilterCount > 0 && <Pill tone="accent">{activeFilterCount} active</Pill>}
            <button type="button" className="btn small ghost" onClick={resetFilters}>
              Clear filters
            </button>
            <LastUpdated at={alerts.lastUpdated} />
          </>
        }
      >
        <div className="grid" style={{ gap: 12 }}>
          <div className="toolbar">
            <div className="field" style={{ minWidth: 240, flex: '1 1 240px' }}>
              <label htmlFor="q">Search (signature, IP, protocol, rule)</label>
              <input
                id="q"
                type="search"
                value={draft.q}
                placeholder="e.g. IPS, 192.168.61.129, icmp, 1000002"
                onChange={(event) => {
                  setDraft({ ...draft, q: event.target.value });
                  setPage(1);
                }}
              />
            </div>
            <div className="field" style={{ minWidth: 150 }}>
              <label htmlFor="src_ip">Source IP</label>
              <input
                id="src_ip"
                type="text"
                value={draft.src_ip}
                placeholder="192.168.61.129"
                onChange={(event) => {
                  setDraft({ ...draft, src_ip: event.target.value });
                  setPage(1);
                }}
              />
            </div>
            <div className="field" style={{ minWidth: 150 }}>
              <label htmlFor="dest_ip">Destination IP</label>
              <input
                id="dest_ip"
                type="text"
                value={draft.dest_ip}
                placeholder="8.8.8.8"
                onChange={(event) => {
                  setDraft({ ...draft, dest_ip: event.target.value });
                  setPage(1);
                }}
              />
            </div>
            <div className="field" style={{ minWidth: 160 }}>
              <label htmlFor="signature">Signature contains</label>
              <input
                id="signature"
                type="text"
                value={draft.signature}
                placeholder="LOCAL IPS TEST"
                onChange={(event) => {
                  setDraft({ ...draft, signature: event.target.value });
                  setPage(1);
                }}
              />
            </div>
            <div className="field" style={{ minWidth: 110 }}>
              <label htmlFor="rule_id">Rule ID</label>
              <input
                id="rule_id"
                type="text"
                value={draft.rule_id}
                placeholder="1000002"
                onChange={(event) => {
                  setDraft({ ...draft, rule_id: event.target.value });
                  setPage(1);
                }}
              />
            </div>
            <div className="field" style={{ minWidth: 130 }}>
              <label htmlFor="proto">Protocol</label>
              <input
                id="proto"
                type="text"
                value={proto}
                placeholder="ICMP / TCP / UDP"
                onChange={(event) => {
                  setProto(event.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="field" style={{ minWidth: 160 }}>
              <label htmlFor="source">Data source</label>
              <select
                id="source"
                value={source}
                onChange={(event) => {
                  setSource(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">Both (live + historical)</option>
                <option value="live">Live telemetry only</option>
                <option value="historical">Historical evidence only</option>
              </select>
            </div>
          </div>

          <div className="toolbar">
            <div className="field">
              <label>Severity</label>
              <div className="chip-group">
                {SEVERITY_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option}
                    className={`chip ${severity.includes(option) ? 'active' : ''} ${
                      option === 'high' ? 'danger' : option === 'medium' ? 'warn' : 'ok'
                    }`}
                    onClick={() => toggle(severity, option, setSeverity)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Action verdict</label>
              <div className="chip-group">
                {ACTION_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option}
                    className={`chip ${action.includes(option) ? 'active' : ''} ${
                      option === 'blocked' ? 'danger' : option === 'allowed' ? 'ok' : ''
                    }`}
                    onClick={() => toggle(action, option, setAction)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <div className="field" style={{ marginLeft: 'auto' }}>
              <label>Page size</label>
              <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size} rows
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn small"
              disabled={events.length === 0}
              onClick={() =>
                downloadCsv(
                  `sentinel-alerts-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`,
                  toCsv(events as unknown as Record<string, unknown>[], CSV_COLUMNS),
                )
              }
            >
              <IconDownload size={13} /> Export this page (CSV)
            </button>
            <button type="button" className="btn small" onClick={alerts.refresh} disabled={alerts.refreshing}>
              <IconRefresh size={13} /> {alerts.refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
      </Panel>

      <Panel
        title="Alert records"
        subtitle={
          data
            ? `${data.total} matching record(s) · live ${data.counts_by_source.live} · historical ${data.counts_by_source.historical}`
            : 'loading…'
        }
        flush
        actions={
          data && (
            <span className="panel-sub mono">
              page {data.page} / {data.pages}
            </span>
          )
        }
      >
        {alerts.loading && !data ? (
          <div style={{ padding: 15 }}>
            <LoadingState rows={6} label="reading EVE records…" />
          </div>
        ) : alerts.error && !data ? (
          <ErrorState
            title="Alert list unavailable"
            detail={alerts.error.message}
            onRetry={alerts.refresh}
            meta="The dashboard does not fall back to cached or sample data — the list stays empty until the API answers."
          />
        ) : events.length === 0 ? (
          <EmptyState
            title="No records match these filters"
            detail={
              activeFilterCount > 0 ? (
                <>
                  Remove a filter, or widen the time window (currently <span className="mono">{soc.window}</span>). The
                  baseline evidence is dated, so a short window legitimately returns nothing.
                </>
              ) : (
                <>
                  Neither the live EVE file nor the historical evidence file contains an alert. See{' '}
                  <Link to="/system" style={{ color: '#7dd3fc' }}>
                    System Health
                  </Link>{' '}
                  for file paths and parse statistics.
                </>
              )
            }
            action={
              activeFilterCount > 0 ? (
                <button type="button" className="btn small" onClick={resetFilters}>
                  Clear all filters
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th className="sortable" onClick={() => onSort('timestamp')}>
                      Timestamp{sortIndicator('timestamp')}
                    </th>
                    <th className="sortable" onClick={() => onSort('source')}>
                      Source{sortIndicator('source')}
                    </th>
                    <th className="sortable" onClick={() => onSort('severity')}>
                      Severity{sortIndicator('severity')}
                    </th>
                    <th className="sortable" onClick={() => onSort('action')}>
                      Action{sortIndicator('action')}
                    </th>
                    <th className="sortable" onClick={() => onSort('signature')}>
                      Signature{sortIndicator('signature')}
                    </th>
                    <th className="sortable" onClick={() => onSort('src_ip')}>
                      Source IP{sortIndicator('src_ip')}
                    </th>
                    <th className="sortable" onClick={() => onSort('dest_ip')}>
                      Destination IP{sortIndicator('dest_ip')}
                    </th>
                    <th className="sortable" onClick={() => onSort('proto')}>
                      Proto{sortIndicator('proto')}
                    </th>
                    <th>Rule</th>
                    <th>Analyst</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <Fragment key={event.event_id}>
                      <tr className="clickable">
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
                          {event.category && <div className="faint small">{event.category}</div>}
                        </td>
                        <td className="mono nowrap">{portLabel(event.src_ip, event.src_port)}</td>
                        <td className="mono nowrap">{portLabel(event.dest_ip, event.dest_port)}</td>
                        <td className="mono">{event.proto}</td>
                        <td className="mono">
                          {event.rule_id ?? '—'}
                          {event.rev ? <span className="faint">.rev{event.rev}</span> : null}
                          {event.is_custom_rule && (
                            <div>
                              <span className="tag">local.rules</span>
                            </div>
                          )}
                        </td>
                        <td>
                          <AnalystBadge status={event.analyst_status} />
                        </td>
                        <td className="nowrap">
                          <Link
                            to={`/investigation/${encodeURIComponent(event.event_id)}`}
                            className="btn small"
                          >
                            <IconSearch size={12} /> Investigate
                          </Link>
                          <button
                            type="button"
                            className="btn small ghost"
                            style={{ marginLeft: 6 }}
                            onClick={() => setExpanded(expanded === event.event_id ? null : event.event_id)}
                          >
                            {expanded === event.event_id ? 'Hide' : 'Raw'}
                          </button>
                        </td>
                      </tr>
                      {expanded === event.event_id && (
                        <tr>
                          <td colSpan={11} style={{ background: '#0a1018' }}>
                            <div className="grid cols-2" style={{ gap: 12 }}>
                              <div>
                                <div className="kv-key" style={{ marginBottom: 4 }}>
                                  Verdict provenance
                                </div>
                                <div className="small">
                                  Recorded action <strong>{event.action}</strong> — decided from{' '}
                                  <span className="mono">{event.action_source}</span>
                                  {event.action_raw ? (
                                    <>
                                      {' '}
                                      (raw value <span className="mono">{event.action_raw}</span>)
                                    </>
                                  ) : null}
                                </div>
                                <div className="kv-key" style={{ margin: '10px 0 4px' }}>
                                  Evidence file
                                </div>
                                <div className="small mono">{event.source_file}</div>
                                <div className="kv-key" style={{ margin: '10px 0 4px' }}>
                                  Event id (stable across polls)
                                </div>
                                <div className="small mono">{event.event_id}</div>
                                <div className="kv-key" style={{ margin: '10px 0 4px' }}>
                                  Flow id / interface / host
                                </div>
                                <div className="small mono">
                                  {String(event.flow_id ?? '—')} · {event.interface ?? '—'} · {event.host ?? '—'}
                                </div>
                              </div>
                              <div>
                                <div className="kv-key" style={{ marginBottom: 4 }}>
                                  Raw EVE excerpt (as stored)
                                </div>
                                <pre className="code">{JSON.stringify(event.raw_excerpt, null, 2)}</pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ padding: 12, borderTop: '1px solid var(--border)' }} className="pagination">
              <button
                type="button"
                className="btn small"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                ← Previous
              </button>
              <button
                type="button"
                className="btn small"
                disabled={!data || page >= data.pages}
                onClick={() => setPage((value) => value + 1)}
              >
                Next →
              </button>
              <span className="page-info">
                page {data?.page ?? 1} of {data?.pages ?? 1} · showing {events.length} of {data?.total ?? 0}
              </span>
              <span className="page-info faint">
                sorted by {data?.sort} {data?.order}
              </span>
              <span style={{ marginLeft: 'auto' }} className="page-info faint">
                {alerts.refreshing ? 'refreshing…' : 'up to date'}
              </span>
            </div>
          </>
        )}
      </Panel>
    </>
  );
}
