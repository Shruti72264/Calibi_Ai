/**
 * Response & Audit.
 *
 * The response workflow is staged on purpose:
 *   1. classify          (automatic, explainable)
 *   2. recommend         (recorded, changes nothing)
 *   3. dry-run           (renders the exact command, executes nothing)
 *   4. enforce           (local host only, allow-listed targets only, rate limited)
 *
 * This page makes the current stage visible, lets an analyst submit a
 * recommendation through the real API, and shows the resulting audit trail —
 * which is the only thing that can ever claim an action happened.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useSoc } from '../context/SocContext';
import { formatTimestamp, relativeTime } from '../lib/format';
import type { ResponseActionResult } from '../api/types';
import {
  ErrorState,
  IconWarning,
  KeyValue,
  LoadingState,
  Notice,
  Panel,
  Pill,
  StatCard,
} from '../components/ui';

const KIND_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'info' | ''> = {
  response_action: 'warn',
  analyst_note: 'info',
  status_change: 'info',
};

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'info' | ''> = {
  executed: 'danger',
  recommended: 'info',
  dry_run: 'info',
  planned: 'info',
  refused: 'warn',
  rejected: 'warn',
  blocked_by_policy: 'warn',
  rate_limited: 'danger',
  failed: 'danger',
  recorded: 'info',
};

export default function ResponseAudit() {
  const soc = useSoc();
  const responseStatus = useApi(({ signal }) => api.responseStatus({ signal }), [], { intervalMs: 30000 });
  const audit = useApi(({ signal }) => api.audit(150, undefined, { signal }), [], { intervalMs: soc.intervalMs });
  const recent = useApi(
    ({ signal }) => api.alerts({ page_size: 12, sort: 'timestamp', order: 'desc', window: soc.window }, { signal }),
    [soc.window],
    { intervalMs: soc.intervalMs },
  );

  const [eventId, setEventId] = useState('');
  const [actionType, setActionType] = useState('block_source_ip');
  const [targetIp, setTargetIp] = useState('');
  const [reason, setReason] = useState('Analyst review of a recorded detection');
  const [authorization, setAuthorization] = useState('');
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [result, setResult] = useState<ResponseActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const mode = responseStatus.data?.mode ?? 'unknown';
  const enforceMode = mode === 'enforce';

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const payload = await api.responseAction({
        event_id: eventId.trim(),
        action_type: actionType,
        target_ip: targetIp.trim() || null,
        reason,
        confirm: confirmChecked,
        authorization,
      });
      setResult(payload);
      audit.refresh();
    } catch (caught) {
      setError((caught as ApiError).message);
    } finally {
      setSubmitting(false);
    }
  };

  const auditEntries = audit.data ?? [];
  const executed = auditEntries.filter((entry) => entry.status === 'executed').length;
  const refused = auditEntries.filter((entry) => ['refused', 'rejected', 'blocked_by_policy', 'rate_limited'].includes(entry.status)).length;

  return (
    <>
      <Notice
        tone={enforceMode ? 'danger' : 'info'}
        title={enforceMode ? 'ENFORCE MODE IS ON — actions can change this host’s firewall' : 'Recommendation mode — nothing on this page changes network state'}
      >
        {enforceMode ? (
          <>
            The backend is configured with <span className="inline-code">SOC_RESPONSE_MODE=enforce</span>. An accepted action
            can modify the local host firewall, but only for allow-listed targets, only after confirmation and an
            authorisation statement, and never on a Cisco device or a remote host.
          </>
        ) : (
          <>
            The backend is in <span className="inline-code">{mode}</span> mode. Submitting below records a recommendation (or,
            in dry-run mode, the exact command that would run) and executes nothing. A status change in this dashboard is{' '}
            <strong>not a network block</strong>.
          </>
        )}
      </Notice>

      <div className="grid stats">
        <StatCard label="Response mode" value={mode} small tone={enforceMode ? 'danger' : 'ok'} foot={`secure default: ${responseStatus.data?.secure_default ?? 'recommend'}`} />
        <StatCard
          label="Allow-listed targets"
          value={responseStatus.data?.allowlist.length ?? 0}
          small
          tone={responseStatus.data?.allowlist_configured ? 'warn' : 'ok'}
          foot={responseStatus.data?.allowlist.join(', ') || 'empty — enforcement is impossible by design'}
        />
        <StatCard
          label="Local firewall"
          value={responseStatus.data?.local_firewall_backend ?? '—'}
          small
          foot="only this host is ever touched"
        />
        <StatCard
          label="Executed in last hour"
          value={responseStatus.data?.recent_executed_actions ?? 0}
          tone={responseStatus.data && responseStatus.data.recent_executed_actions > 0 ? 'warn' : ''}
          foot={`circuit breaker at ${responseStatus.data?.max_actions_per_hour ?? '—'}/hour`}
        />
        <StatCard label="Audit entries" value={auditEntries.length} foot={`${executed} executed · ${refused} refused`} />
      </div>

      <div className="grid split">
        <Panel
          title="Submit a controlled response"
          subtitle="Uses the same validation and audit path as the investigation page"
        >
          <div className="grid cols-2" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="event-id">Event id (from the alerts console)</label>
              <input
                id="event-id"
                type="text"
                value={eventId}
                placeholder="e.g. 4f2a91c0b7e35a18"
                onChange={(event) => setEventId(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="action-type">Action</label>
              <select id="action-type" value={actionType} onChange={(event) => setActionType(event.target.value)}>
                <option value="block_source_ip">block_source_ip</option>
                <option value="unblock_source_ip">unblock_source_ip (rollback)</option>
                <option value="quarantine_flow">quarantine_flow (documented as out of scope)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="target-ip">Target IP (defaults to the event's source)</label>
              <input
                id="target-ip"
                type="text"
                value={targetIp}
                placeholder="must be on the allow list to be enforceable"
                onChange={(event) => setTargetIp(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="reason">Reason (recorded in the audit log)</label>
              <input id="reason" type="text" value={reason} onChange={(event) => setReason(event.target.value)} />
            </div>
          </div>

          {enforceMode && (
            <div style={{ marginTop: 10 }}>
              <div className="field">
                <label htmlFor="authorization">Authorisation statement (required in enforce mode)</label>
                <input
                  id="authorization"
                  type="text"
                  value={authorization}
                  placeholder="e.g. Authorised to block this lab host during today's test window"
                  onChange={(event) => setAuthorization(event.target.value)}
                />
              </div>
              <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 9 }}>
                <input type="checkbox" checked={confirmChecked} onChange={(event) => setConfirmChecked(event.target.checked)} />
                I confirm this action is authorised and I accept the recorded rollback responsibility.
              </label>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn small ${enforceMode ? 'danger' : 'primary'}`}
              disabled={submitting || eventId.trim().length < 4 || reason.trim().length < 4}
              onClick={submit}
            >
              {submitting ? 'Submitting…' : enforceMode ? 'Submit for enforcement' : 'Record recommendation'}
            </button>
            <button
              type="button"
              className="btn small ghost"
              onClick={() => {
                const pick = recent.data?.items[0];
                if (pick) {
                  setEventId(pick.event_id);
                  setTargetIp(pick.src_ip ?? '');
                }
              }}
            >
              Use most recent event
            </button>
          </div>

          {error && (
            <Notice tone="warn" title="Request refused or failed">
              {error}
            </Notice>
          )}

          {result && (
            <div className="notice ok" style={{ marginTop: 10 }}>
              <div>
                <div className="notice-title">
                  Audit #{result.audit_id} · mode {result.mode} · executed {String(result.executed)}
                </div>
                <div className="small">{result.message}</div>
                <KeyValue
                  rows={[
                    { key: 'Action', value: <span className="mono">{result.action_type}</span> },
                    { key: 'Target', value: <span className="mono">{result.target_ip ?? 'none'}</span> },
                    { key: 'Executor', value: <span className="mono small">{result.plan.executor}</span> },
                    {
                      key: 'Plan feasible',
                      value: result.plan.feasible ? <Pill tone="ok">yes</Pill> : <Pill tone="warn">no</Pill>,
                    },
                    ...(result.plan.command_preview
                      ? [{ key: 'Command (preview)', value: <span className="mono small">{result.plan.command_preview}</span> }]
                      : []),
                    ...(result.plan.rollback_preview
                      ? [{ key: 'Rollback', value: <span className="mono small">{result.plan.rollback_preview}</span> }]
                      : []),
                  ]}
                />
                {(result.warnings.length > 0 || result.plan.blockers.length > 0) && (
                  <ul className="list small" style={{ marginTop: 8 }}>
                    {[...result.warnings, ...result.plan.blockers].map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Panel>

        <div className="grid" style={{ gap: 14, alignContent: 'start' }}>
          <Panel title="Safety envelope" subtitle="Enforced by the backend, not by this UI">
            <div className="kv-key" style={{ marginBottom: 6 }}>
              Capabilities
            </div>
            <ul className="list small">
              {(responseStatus.data?.capabilities ?? []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="kv-key" style={{ margin: '12px 0 6px' }}>
              Explicitly out of scope
            </div>
            <ul className="list small">
              {(responseStatus.data?.explicitly_out_of_scope ?? []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <Notice tone="warn" title="Why there is no command endpoint">
              The API accepts an action *type* and an IP, never a command line. Anyone can read this dashboard's source and
              see exactly what is executable: a single firewall rule on the local host, scoped to an allow-listed address,
              with its rollback recorded before execution.
            </Notice>
          </Panel>

          <Panel title="Rollback procedure" subtitle="How to undo an enforced action">
            <pre className="code">{`# 1. List what the platform did (every executed action records its rollback)
curl -s http://127.0.0.1:8000/api/audit?limit=20 | python3 -m json.tool | grep -A2 rollback

# 2. The dashboard's own rollback path (allow-listed targets only)
#    Response & Audit → action_type = unblock_source_ip

# 3. Manual verification on the host
sudo iptables -L SENTINEL_SOC -n --line-numbers
sudo iptables -D SENTINEL_SOC -s <target-ip> -j DROP   # if it was added
sudo nft list set inet sentinel_soc blocked_v4         # nftables deployments
sudo ufw status numbered                               # ufw deployments`}</pre>
            <div className="panel-sub faint" style={{ marginTop: 8 }}>
              Rollback is recorded before the action runs, so a failed execution is still reversible from the audit log.
            </div>
          </Panel>
        </div>
      </div>

      <Panel
        title="Audit trail"
        subtitle="Every attempted action, including refusals — the only authoritative record of what the platform did"
        flush
        actions={
          <button type="button" className="btn small" onClick={audit.refresh} disabled={audit.refreshing}>
            {audit.refreshing ? 'Refreshing…' : 'Refresh trail'}
          </button>
        }
      >
        {audit.loading && !audit.data ? (
          <div style={{ padding: 15 }}>
            <LoadingState rows={5} />
          </div>
        ) : audit.error && !audit.data ? (
          <ErrorState detail={audit.error.message} onRetry={audit.refresh} />
        ) : auditEntries.length === 0 ? (
          <ErrorState
            title="No audit entries yet"
            detail="Nothing has been recorded. Submit a recommendation above, or add an analyst note from Event Investigation, and it will appear here immediately."
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Mode</th>
                  <th>Target</th>
                  <th>Event</th>
                  <th>Detail</th>
                  <th>Rollback</th>
                </tr>
              </thead>
              <tbody>
                {auditEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="mono">{entry.id}</td>
                    <td className="mono small nowrap">
                      {formatTimestamp(entry.created_at)}
                      <div className="faint">{relativeTime(entry.created_at)}</div>
                    </td>
                    <td className="small">{entry.actor}</td>
                    <td>
                      <Pill tone={KIND_TONE[entry.kind] ?? ''}>{entry.kind}</Pill>
                    </td>
                    <td>
                      <Pill tone={STATUS_TONE[entry.status] ?? ''}>{entry.status}</Pill>
                    </td>
                    <td className="mono small">{entry.mode ?? '—'}</td>
                    <td className="mono small">{entry.target ?? '—'}</td>
                    <td className="mono small">
                      {entry.event_id ? (
                        <Link to={`/investigation/${encodeURIComponent(entry.event_id)}`} style={{ color: '#7dd3fc' }}>
                          {entry.event_id.slice(0, 10)}…
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="small" style={{ maxWidth: 320 }}>
                      {entry.detail}
                    </td>
                    <td className="mono small faint" style={{ maxWidth: 220 }}>
                      {entry.rollback ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="notice">
        <span className="notice-icon">
          <IconWarning size={14} />
        </span>
        <div>
          <strong>Honesty rule:</strong> the word "blocked" on this dashboard always means a recorded drop in the EVE
          evidence. An audit entry with status <span className="inline-code">recommended</span> means an analyst proposed an
          action — it is never reported as a network change.
        </div>
      </div>
    </>
  );
}
