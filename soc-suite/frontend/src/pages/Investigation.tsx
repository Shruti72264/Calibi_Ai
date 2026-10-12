/**
 * Event Investigation.
 *
 * With no :eventId the page acts as a picker; with one it renders the full
 * investigative view: the evidence, the verdict provenance, the correlation
 * timeline, related events, analyst notes and the (recommendation-only by
 * default) response workflow.
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useSoc } from '../context/SocContext';
import { formatTimestamp, portLabel, relativeTime } from '../lib/format';
import type { ResponseActionResult, SocEvent } from '../api/types';
import {
  ActionBadge,
  AnalystBadge,
  ErrorState,
  IconBack,
  IconInfo,
  IconWarning,
  KeyValue,
  LoadingState,
  Notice,
  Panel,
  Pill,
  SeverityBadge,
  SourceBadge,
} from '../components/ui';

const TONES: Record<string, 'danger' | 'warn' | 'ok'> = { P1: 'danger', P2: 'warn', P3: 'ok' };

function EventRow({ event }: { event: SocEvent }) {
  return (
    <div className="kv-row" style={{ gridTemplateColumns: '1fr auto' }}>
      <div>
        <Link to={`/investigation/${encodeURIComponent(event.event_id)}`} style={{ color: '#7dd3fc' }} className="small">
          {event.signature}
        </Link>
        <div className="small faint mono">
          {formatTimestamp(event.timestamp)} · {portLabel(event.src_ip, event.src_port)} →{' '}
          {portLabel(event.dest_ip, event.dest_port)} · {event.proto} · flow {String(event.flow_id ?? '—')}
        </div>
      </div>
      <div className="nowrap">
        <SeverityBadge severity={event.severity} /> <ActionBadge action={event.action} />
      </div>
    </div>
  );
}

function Picker() {
  const soc = useSoc();
  const list = useApi(
    ({ signal }) => api.alerts({ page: 1, page_size: 15, sort: 'timestamp', order: 'desc', window: soc.window }, { signal }),
    [soc.window],
    { intervalMs: soc.intervalMs },
  );

  return (
    <Panel
      title="Choose an event to investigate"
      subtitle="Most recent first — or open one directly from the alerts console"
      flush
      actions={
        <Link to="/alerts" className="btn small">
          Open alerts console
        </Link>
      }
    >
      {list.loading && !list.data ? (
        <div style={{ padding: 15 }}>
          <LoadingState rows={5} />
        </div>
      ) : list.error && !list.data ? (
        <ErrorState detail={list.error.message} onRetry={list.refresh} />
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <ErrorState
          title="No events available to investigate"
          detail="Neither data source returned an alert in the current window. Check System Health for the EVE file paths."
        />
      ) : (
        <div style={{ padding: '4px 15px 12px' }}>
          {list.data?.items.map((event) => (
            <EventRow key={event.event_id} event={event} />
          ))}
        </div>
      )}
    </Panel>
  );
}

export default function Investigation() {
  const { eventId } = useParams<{ eventId?: string }>();
  const soc = useSoc();
  const [noteText, setNoteText] = useState('');
  const [noteStatus, setNoteStatus] = useState('investigating');
  const [noteMessage, setNoteMessage] = useState<{ tone: 'ok' | 'danger' | 'warn'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionResult, setActionResult] = useState<ResponseActionResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reason, setReason] = useState('Analyst review of recorded detection');
  const [runningAction, setRunningAction] = useState(false);

  const detail = useApi(
    ({ signal }) => api.alert(eventId as string, { signal }),
    [eventId],
    { enabled: Boolean(eventId), intervalMs: 0 },
  );

  if (!eventId) return <Picker />;

  if (detail.loading && !detail.data) {
    return (
      <Panel title="Loading event…">
        <LoadingState rows={6} />
      </Panel>
    );
  }

  if (detail.error && !detail.data) {
    return (
      <Panel title="Event not available">
        <ErrorState
          title={`Event ${eventId} could not be loaded`}
          detail={detail.error.message}
          onRetry={detail.refresh}
          meta={
            detail.error.status === 404
              ? 'EVE logs rotate. If the event is older than the current file and not present in the historical evidence file, it is genuinely gone — the dashboard will not invent a placeholder.'
              : undefined
          }
        />
        <div style={{ paddingTop: 12 }}>
          <Link to="/alerts" className="btn small">
            <IconBack size={13} /> Back to alerts
          </Link>
        </div>
      </Panel>
    );
  }

  const { event, related, timeline, notes, response_recommendation: recommendation } = detail.data!;
  const writeEnabled = soc.system.data?.backend.write_protection.writes_enabled ?? false;

  const submitNote = async () => {
    setSaving(true);
    setNoteMessage(null);
    try {
      await api.addNote(event.event_id, { note: noteText, author: 'soc-analyst', status: noteStatus });
      setNoteText('');
      setNoteMessage({
        tone: 'ok',
        text: 'Note recorded. This is analyst bookkeeping only — no network or firewall state changed.',
      });
      detail.refresh();
    } catch (error) {
      const apiError = error as ApiError;
      setNoteMessage({
        tone: apiError.status === 403 ? 'warn' : 'danger',
        text:
          apiError.status === 403
            ? `${apiError.message}`
            : `Could not record the note: ${apiError.message}`,
      });
    } finally {
      setSaving(false);
    }
  };

  const submitResponse = async (actionType: string) => {
    setRunningAction(true);
    setActionError(null);
    setActionResult(null);
    try {
      const result = await api.responseAction({
        event_id: event.event_id,
        action_type: actionType,
        target_ip: event.src_ip,
        reason,
        confirm: false,
        authorization: '',
      });
      setActionResult(result);
    } catch (error) {
      setActionError((error as ApiError).message);
    } finally {
      setRunningAction(false);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Link to="/alerts" className="btn small">
          <IconBack size={13} /> Alerts console
        </Link>
        <span className="panel-sub mono faint">event {event.event_id}</span>
        <span style={{ marginLeft: 'auto' }}>
          <SourceBadge source={event.source} />
        </span>
      </div>

      <Panel
        title={event.signature}
        subtitle={
          <span className="mono">
            rule {event.rule_id ?? '—'}
            {event.rev ? `.rev${event.rev}` : ''} · gid {String(event.gid ?? '—')} · {event.category ?? 'uncategorised'}
          </span>
        }
        actions={
          <>
            <SeverityBadge severity={event.severity} />
            <ActionBadge action={event.action} />
            <Pill tone={TONES[recommendation.priority] ?? 'info'}>{recommendation.priority}</Pill>
            <AnalystBadge status={event.analyst_status} />
          </>
        }
      >
        <div className="grid cols-4">
          <KeyValue
            rows={[
              { key: 'Timestamp (UTC)', value: <span className="mono">{formatTimestamp(event.timestamp)}</span> },
              { key: 'Recorded', value: relativeTime(event.timestamp) },
              { key: 'Event type', value: <span className="mono">{event.event_type}</span> },
              { key: 'Event id', value: <span className="mono">{event.event_id}</span> },
            ]}
          />
          <KeyValue
            rows={[
              { key: 'Source', value: <span className="mono">{portLabel(event.src_ip, event.src_port)}</span> },
              { key: 'Destination', value: <span className="mono">{portLabel(event.dest_ip, event.dest_port)}</span> },
              { key: 'Protocol', value: <span className="mono">{event.proto}{event.app_proto ? ` / ${event.app_proto}` : ''}</span> },
              { key: 'Flow id', value: <span className="mono">{String(event.flow_id ?? '—')}</span> },
            ]}
          />
          <KeyValue
            rows={[
              { key: 'Sensor host', value: <span className="mono">{event.host ?? 'not recorded'}</span> },
              { key: 'Capture interface', value: <span className="mono">{event.interface ?? 'not recorded'}</span> },
              { key: 'Community id', value: <span className="mono">{event.community_id ?? 'not recorded'}</span> },
              { key: 'PCAP', value: <span className="mono">{event.pcap_file ?? 'not recorded'}</span> },
            ]}
          />
          <KeyValue
            rows={[
              { key: 'Data source', value: <SourceBadge source={event.source} /> },
              { key: 'Custom rule', value: event.is_custom_rule ? <Pill tone="accent">yes — local.rules</Pill> : 'no' },
              { key: 'Evidence file', value: <span className="mono small">{event.source_file}</span> },
              { key: 'Analyst notes', value: `${event.analyst_note_count}` },
            ]}
          />
        </div>
      </Panel>

      <div className="grid split">
        <Panel title="Correlation timeline" subtitle="The focal event plus everything sharing its flow or source">
          {timeline.length <= 1 ? (
            <Notice tone="info" title="No correlated events recorded">
              Only this event shares its flow id, source or destination in the loaded window. A single detection is not
              weak evidence — it just means no companion record was written.
            </Notice>
          ) : (
            <div className="timeline">
              {timeline.map((node, index) => (
                <div className="timeline-item" key={`${node.event_id}-${index}`}>
                  <div className="timeline-time">{formatTimestamp(node.timestamp).slice(11, 19)}</div>
                  <div className="timeline-rail">
                    <span className={`timeline-dot ${node.kind === 'focal' ? 'focal' : ''}`} />
                    {index < timeline.length - 1 && <span className="timeline-line" />}
                  </div>
                  <div className="timeline-body">
                    <div className="timeline-label">
                      {node.kind === 'focal' ? <strong>{node.label}</strong> : node.label}
                      <span className="tag" style={{ marginLeft: 7 }}>
                        {node.correlation}
                      </span>
                    </div>
                    <div className="timeline-detail">{node.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <div className="grid" style={{ gap: 14, alignContent: 'start' }}>
          <Panel title="Verdict provenance" subtitle="Why the dashboard believes the action it shows">
            <Notice tone={event.action === 'blocked' ? 'danger' : event.action === 'allowed' ? 'ok' : 'warn'}>
              <div>
                Recorded action: <strong>{event.action}</strong>
              </div>
              <div className="small">
                Decided from <span className="mono">{event.action_source}</span>
                {event.action_raw ? (
                  <>
                    {' '}
                    · raw EVE value <span className="mono">{event.action_raw}</span>
                  </>
                ) : null}
              </div>
              {event.action === 'unknown' && (
                <div className="small" style={{ marginTop: 4 }}>
                  The EVE record did not state whether this traffic was passed or dropped. Corroborate with flow records
                  before drawing a conclusion.
                </div>
              )}
            </Notice>
            <div style={{ marginTop: 11 }}>
              <div className="kv-key" style={{ marginBottom: 5 }}>
                Raw EVE excerpt
              </div>
              <pre className="code">{JSON.stringify(event.raw_excerpt, null, 2)}</pre>
            </div>
            {event.payload_printable && (
              <div style={{ marginTop: 11 }}>
                <div className="kv-key" style={{ marginBottom: 5 }}>
                  Payload (as recorded, truncated)
                </div>
                <pre className="code">{event.payload_printable}</pre>
              </div>
            )}
          </Panel>

          <Panel title="Response recommendation" subtitle="Rule-based classification — explainable, not magic">
            <KeyValue
              rows={[
                { key: 'Category', value: recommendation.category },
                { key: 'ATT&CK-style technique', value: <span className="mono small">{recommendation.technique}</span> },
                { key: 'Priority', value: <Pill tone={TONES[recommendation.priority] ?? 'info'}>{recommendation.priority}</Pill> },
                { key: 'Suggested action', value: <span className="mono">{recommendation.suggested_action ?? 'none'}</span> },
              ]}
            />
            <div className="notice info" style={{ marginTop: 10 }}>
              <span className="notice-icon">
                <IconInfo size={14} />
              </span>
              <div>{recommendation.recommendation}</div>
            </div>

            <div className="divider" />

            <div className="field">
              <label htmlFor="reason">Reason recorded with the action</label>
              <input id="reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {recommendation.suggested_action ? (
                <button
                  type="button"
                  className="btn primary small"
                  disabled={runningAction}
                  onClick={() => submitResponse(recommendation.suggested_action as string)}
                >
                  {runningAction ? 'Submitting…' : 'Record recommendation for source IP'}
                </button>
              ) : (
                <button type="button" className="btn small" disabled>
                  No action recommended
                </button>
              )}
              <button
                type="button"
                className="btn small ghost"
                disabled={runningAction}
                onClick={() => submitResponse('quarantine_flow')}
              >
                Try flow quarantine (expected: refused)
              </button>
            </div>

            {actionError && (
              <div className="notice warn" style={{ marginTop: 10 }}>
                <span className="notice-icon">
                  <IconWarning size={14} />
                </span>
                <div>{actionError}</div>
              </div>
            )}

            {actionResult && (
              <div className="notice ok" style={{ marginTop: 10 }}>
                <div>
                  <div className="notice-title">
                    Action {actionResult.mode === 'recommend' ? 'recorded as a recommendation' : actionResult.mode} ·
                    audit #{actionResult.audit_id}
                  </div>
                  <div className="small">{actionResult.message}</div>
                  <div className="small mono">target: {actionResult.target_ip ?? 'none'} · executed: {String(actionResult.executed)}</div>
                  {actionResult.plan.command_preview && (
                    <pre className="code" style={{ marginTop: 8 }}>
                      would run: {actionResult.plan.command_preview}
                      {'\n'}rollback : {actionResult.plan.rollback_preview}
                    </pre>
                  )}
                  {actionResult.warnings.length > 0 && (
                    <ul className="list small" style={{ marginTop: 8 }}>
                      {actionResult.warnings.map((warning, index) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
            <div className="panel-sub faint" style={{ marginTop: 8 }}>
              Response mode: <span className="mono">{soc.system.data?.response.mode ?? 'unknown'}</span> · allow list:{' '}
              <span className="mono">
                {soc.system.data?.response.allowlist.length ? soc.system.data.response.allowlist.join(', ') : 'empty'}
              </span>
            </div>
          </Panel>

          <Panel
            title="Analyst notes"
            subtitle="Triage bookkeeping — explicitly not a network action"
            actions={<AnalystBadge status={event.analyst_status} />}
          >
            {notes.length === 0 ? (
              <div className="panel-sub">No notes recorded for this event yet.</div>
            ) : (
              <div className="grid" style={{ gap: 9 }}>
                {notes.map((note) => (
                  <div key={note.id} className="notice">
                    <div>
                      <div className="small">
                        <strong>{note.author}</strong> · <span className="mono faint">{formatTimestamp(note.created_at)}</span>
                        {note.status ? <span className="tag" style={{ marginLeft: 6 }}>{note.status}</span> : null}
                      </div>
                      <div className="small">{note.note}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="divider" />

            {!writeEnabled && (
              <Notice tone="warn" title="Read-only API">
                Write endpoints are disabled, so notes cannot be saved. To enable them set both{' '}
                <span className="inline-code">SOC_API_KEY</span> and{' '}
                <span className="inline-code">SOC_ALLOW_WRITES=true</span> on the backend and send the key as{' '}
                <span className="inline-code">X-API-Key</span>. This page deliberately does not bypass that gate.
              </Notice>
            )}

            <div className="field" style={{ marginTop: 9 }}>
              <label htmlFor="note">New note</label>
              <textarea
                id="note"
                value={noteText}
                placeholder="What did you check? What did you conclude?"
                onChange={(e) => setNoteText(e.target.value)}
              />
            </div>
            <div className="toolbar" style={{ marginTop: 9 }}>
              <div className="field">
                <label htmlFor="note-status">Set status</label>
                <select id="note-status" value={noteStatus} onChange={(e) => setNoteStatus(e.target.value)}>
                  <option value="investigating">Investigating</option>
                  <option value="resolved">Resolved</option>
                  <option value="false_positive">False positive</option>
                  <option value="new">New</option>
                </select>
              </div>
              <button
                type="button"
                className="btn primary small"
                onClick={submitNote}
                disabled={saving || noteText.trim().length < 2}
              >
                {saving ? 'Saving…' : 'Record note'}
              </button>
            </div>
            {noteMessage && (
              <div className={`notice ${noteMessage.tone === 'ok' ? 'ok' : noteMessage.tone === 'warn' ? 'warn' : 'danger'}`} style={{ marginTop: 9 }}>
                <div className="small">{noteMessage.text}</div>
              </div>
            )}
          </Panel>
        </div>
      </div>

      <div className="grid cols-2">
        <Panel
          title="Related by flow id"
          subtitle={event.flow_id !== null && event.flow_id !== undefined ? `flow ${event.flow_id}` : 'no flow id recorded'}
        >
          {related.by_flow_id.length === 0 ? (
            <div className="panel-sub">No other events share this flow id in the loaded window.</div>
          ) : (
            related.by_flow_id.map((item) => <EventRow key={item.event_id} event={item} />)
          )}
        </Panel>
        <Panel title="Related by source IP" subtitle={event.src_ip ?? 'no source recorded'}>
          {related.by_source_ip.length === 0 ? (
            <div className="panel-sub">No other events from {event.src_ip ?? 'this source'}.</div>
          ) : (
            related.by_source_ip.map((item) => <EventRow key={item.event_id} event={item} />)
          )}
        </Panel>
        <Panel title="Related by destination IP" subtitle={event.dest_ip ?? 'no destination recorded'}>
          {related.by_destination_ip.length === 0 ? (
            <div className="panel-sub">No other events targeting {event.dest_ip ?? 'this host'}.</div>
          ) : (
            related.by_destination_ip.map((item) => <EventRow key={item.event_id} event={item} />)
          )}
        </Panel>
        <Panel title="Related by signature" subtitle={event.signature}>
          {related.by_signature.length === 0 ? (
            <div className="panel-sub">This rule has not fired on any other event in the window.</div>
          ) : (
            related.by_signature.map((item) => <EventRow key={item.event_id} event={item} />)
          )}
        </Panel>
      </div>
    </>
  );
}
