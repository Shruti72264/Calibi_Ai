/**
 * IDS / IPS Monitoring.
 *
 * The page refuses to imply that the sensor is running: the service state comes
 * from a probe executed on the API host at `checked_at`, and every probe that
 * could not be performed is rendered as "not probed" with the reason.
 *
 * It also carries the safe enablement procedure, because the most dangerous
 * thing a new analyst can do with Suricata is restart it blindly - especially
 * while an IPS drop rule is loaded.
 */

import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useSoc } from '../context/SocContext';
import { formatBytes, formatTimestamp, relativeTime } from '../lib/format';
import {
  ActionBadge,
  Bars,
  ErrorState,
  IconWarning,
  KeyValue,
  LoadingState,
  Notice,
  Panel,
  Pill,
  SeverityBadge,
  SourceBadge,
  StatCard,
} from '../components/ui';

/** Documented contents of /etc/suricata/rules/local.rules (project evidence). */
const CUSTOM_RULES = [
  {
    sid: 1000001,
    action: 'alert',
    signature: 'LOCAL IDS TEST',
    text: 'alert icmp any any -> any any (msg:"LOCAL IDS TEST"; sid:1000001; rev:1;)',
    purpose: 'Detection-only baseline. Proves the sensor sees traffic and the rule engine fires.',
    observed: 'matched, traffic permitted (EVE alert.action = allowed)',
  },
  {
    sid: 1000002,
    action: 'drop',
    signature: 'LOCAL IPS TEST - ICMP BLOCKED',
    text: 'drop icmp any any -> 8.8.8.8 any (msg:"LOCAL IPS TEST - ICMP BLOCKED"; sid:1000002; rev:1;)',
    purpose: 'Controlled blocking test. Requires the IPS path (NFQUEUE) to be in place for the drop to take effect.',
    observed: 'matched, packet dropped (EVE alert.action = blocked)',
  },
];

export default function IdsIps() {
  const soc = useSoc();
  const suricata = useApi(({ signal }) => api.suricata({ signal }), [], { intervalMs: 30000 });
  const customEvents = useApi(
    ({ signal }) => api.alerts({ page_size: 50, sort: 'timestamp', order: 'desc', signature: '' }, { signal }),
    [],
    { intervalMs: soc.intervalMs },
  );
  const stats = useApi(({ signal }) => api.stats(soc.window, 'all', { signal }), [soc.window], {
    intervalMs: soc.intervalMs,
  });

  const status = suricata.data;
  const eve = (status?.eve_file ?? {}) as Record<string, unknown>;
  const fastLog = (status?.fast_log ?? {}) as Record<string, unknown>;
  const statsLog = (status?.stats_log ?? {}) as Record<string, unknown>;

  const rules = stats.data?.top_signatures.filter((row) => row.key.startsWith('LOCAL')) ?? [];
  const events = customEvents.data?.items.filter((event) => event.is_custom_rule) ?? [];
  const liveCount = events.filter((event) => event.source === 'live').length;
  const historicalCount = events.filter((event) => event.source === 'historical').length;

  const serviceTone = !status
    ? ''
    : status.service_state === 'active' || status.service_state.startsWith('active (')
      ? 'ok'
      : status.service_state === 'unknown'
        ? 'warn'
        : 'danger';

  return (
    <>
      <Notice tone="info" title="Where these detections come from">
        The custom rules below live on the Kali sensor (<span className="inline-code">/etc/suricata/rules/local.rules</span>)
        and act on real traffic on that host's capture path. They have nothing to do with the Packet Tracer simulation, whose
        frames never reach this sensor. Historical hits are labelled as such; a live hit appears the moment the EVE file
        contains one.
      </Notice>

      <div className="grid stats">
        <StatCard
          label="Sensor service state"
          value={status?.service_state ?? 'unknown'}
          small
          tone={serviceTone as '' | 'ok' | 'warn' | 'danger'}
          foot={status ? `probed ${relativeTime(status.checked_at)}` : 'probing…'}
        />
        <StatCard
          label="Suricata version"
          value={status?.version ?? (status?.binary_present ? 'unknown' : 'not installed')}
          small
          foot={status?.binary_path ?? 'binary not found on the API host'}
        />
        <StatCard
          label="EVE file size"
          value={formatBytes((eve.size_bytes as number | null) ?? null)}
          tone={eve.size_bytes === 0 ? 'warn' : ''}
          foot={eve.exists ? `modified ${relativeTime(String(eve.modified_at))}` : 'file not found'}
        />
        <StatCard
          label="Custom-rule events"
          value={events.length}
          foot={`${liveCount} live · ${historicalCount} historical`}
        />
        <StatCard label="Blocked by IPS rule" value={stats.data?.totals.blocked ?? '—'} tone="danger" foot="action = blocked" />
        <StatCard label="Permitted detections" value={stats.data?.totals.allowed ?? '—'} tone="ok" foot="detection-only rule" />
      </div>

      <div className="grid split">
        <Panel
          title="Sensor probe"
          subtitle={status ? `Executed on the API host at ${formatTimestamp(status.checked_at)}` : 'probing…'}
          actions={
            <>
              <Pill tone={status?.binary_present ? 'ok' : 'warn'}>
                {status?.binary_present ? 'binary present' : 'binary not found'}
              </Pill>
              <button type="button" className="btn small" onClick={suricata.refresh}>
                Re-probe
              </button>
            </>
          }
        >
          {suricata.loading && !status ? (
            <LoadingState rows={5} />
          ) : suricata.error && !status ? (
            <ErrorState detail={suricata.error.message} onRetry={suricata.refresh} />
          ) : (
            <>
              <KeyValue
                rows={[
                  {
                    key: 'Service state',
                    value: (
                      <span className="mono">
                        {status?.service_state}
                        {status?.process_count !== null && status?.process_count !== undefined
                          ? ` · ${status.process_count} process(es) visible via /proc`
                          : ' · process table not readable'}
                      </span>
                    ),
                  },
                  { key: 'Probe used', value: <span className="mono small">{status?.service_probe || 'none'}</span> },
                  {
                    key: 'EVE log',
                    value: (
                      <span className="mono small">
                        {String(eve.path)} · exists {String(eve.exists)} · readable {String(eve.readable)} ·{' '}
                        {formatBytes((eve.size_bytes as number | null) ?? null)}
                      </span>
                    ),
                  },
                  {
                    key: 'fast.log',
                    value: (
                      <span className="mono small">
                        {String(fastLog.path)} · exists {String(fastLog.exists)} ·{' '}
                        {formatBytes((fastLog.size_bytes as number | null) ?? null)}
                      </span>
                    ),
                  },
                  {
                    key: 'stats.log',
                    value: (
                      <span className="mono small">
                        {String(statsLog.path)} · exists {String(statsLog.exists)} ·{' '}
                        {formatBytes((statsLog.size_bytes as number | null) ?? null)}
                      </span>
                    ),
                  },
                ]}
              />
              {status?.note && (
                <Notice tone={status.service_state === 'active' ? 'ok' : 'warn'} title="Interpretation">
                  {status.note}
                  {status.interpretation && <div className="small" style={{ marginTop: 6 }}>{status.interpretation}</div>}
                </Notice>
              )}
              {status && status.rule_files_visible.length > 0 && (
                <div style={{ marginTop: 11 }}>
                  <div className="kv-key" style={{ marginBottom: 5 }}>
                    Rule files visible to the API process (read-only inspection)
                  </div>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Path</th>
                          <th className="num">Size</th>
                          <th>Modified</th>
                          <th>Readable</th>
                        </tr>
                      </thead>
                      <tbody>
                        {status.rule_files_visible.map((file) => (
                          <tr key={file.path}>
                            <td className="mono small">{file.path}</td>
                            <td className="num">{formatBytes(file.size_bytes)}</td>
                            <td className="mono small faint">{formatTimestamp(file.modified_at)}</td>
                            <td>{file.readable ? <Pill tone="ok">yes</Pill> : <Pill tone="warn">no</Pill>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="panel-sub faint" style={{ marginTop: 10 }}>
                The API never starts, stops, reloads or reconfigures Suricata. These are read-only probes; changing sensor
                state is an operator action performed on the sensor itself.
              </div>
            </>
          )}
        </Panel>

        <Panel title="Recorded detections by signature" subtitle="From the parsed EVE records in scope">
          {stats.data ? (
            <Bars data={rules} tone="warn" emptyLabel="no custom-rule signatures in scope" />
          ) : (
            <LoadingState rows={2} />
          )}
          <div className="divider" />
          <div className="kv-key" style={{ marginBottom: 6 }}>
            Action split for these rules
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Pill tone="ok">{stats.data?.totals.allowed ?? 0} allowed</Pill>
            <Pill tone="danger">{stats.data?.totals.blocked ?? 0} blocked</Pill>
            <Pill tone="unknown">{stats.data?.totals.unknown_action ?? 0} unknown</Pill>
          </div>
          <div className="panel-sub" style={{ marginTop: 10 }}>
            A blocked count only ever comes from an EVE record whose action field (or drop event type) says the packet was
            dropped. The dashboard never promotes a detection to a block.
          </div>
        </Panel>
      </div>

      <Panel title="Custom rule registry" subtitle="Documented contents of local.rules and what each rule proved" flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>SID</th>
                <th>Action</th>
                <th>Rule text</th>
                <th>Purpose</th>
                <th>Observed outcome</th>
              </tr>
            </thead>
            <tbody>
              {CUSTOM_RULES.map((rule) => (
                <tr key={rule.sid}>
                  <td className="mono cell-strong">{rule.sid}</td>
                  <td>
                    {rule.action === 'drop' ? <Pill tone="danger">drop (IPS)</Pill> : <Pill tone="ok">alert (IDS)</Pill>}
                  </td>
                  <td className="mono small" style={{ maxWidth: 340 }}>
                    {rule.text}
                  </td>
                  <td className="small">{rule.purpose}</td>
                  <td className="small dim">{rule.observed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Custom-rule events"
        subtitle="Each row keeps its source label — live and historical are never mixed silently"
        flush
        actions={<Link to="/alerts" className="btn small">Open alerts console</Link>}
      >
        {customEvents.loading && !customEvents.data ? (
          <div style={{ padding: 15 }}>
            <LoadingState rows={4} />
          </div>
        ) : (events.length ?? 0) === 0 ? (
          <ErrorState
            title="No custom-rule events in the current window"
            detail="Either the sensor has not written a matching alert yet, or the time window excludes the recorded evidence. Widen the window from the topbar."
            onRetry={customEvents.refresh}
          />
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
                  <th>Evidence file</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
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
                    <td className="cell-strong">{event.signature}</td>
                    <td className="mono small">
                      {event.src_ip} → {event.dest_ip}
                      <div className="faint">{event.proto}</div>
                    </td>
                    <td className="mono small faint">{event.source_file}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Safely enabling detection — and an isolated IPS test"
        subtitle="Run these on the Kali sensor. Read the warnings before the first command."
      >
        <div className="grid cols-2">
          <div>
            <div className="kv-key" style={{ marginBottom: 6 }}>
              1. Inspect before you change anything
            </div>
            <pre className="code">{`# What is the sensor actually doing right now?
sudo systemctl status suricata
ps -ef | grep -i suricata | grep -v grep
sudo ls -l /var/log/suricata/          # note sizes: an empty eve.json is a real answer

# Which rules are loaded, and did the config validate?
grep -n "rule-files" /etc/suricata/suricata.yaml
sudo suricata -T -c /etc/suricata/suricata.yaml     # -T = test only, changes nothing`}</pre>

            <div className="kv-key" style={{ margin: '12px 0 6px' }}>
              2. Start IDS (detection only — cannot block)
            </div>
            <pre className="code">{`sudo systemctl start suricata
# or, interface mode in the foreground so you can watch it:
sudo suricata -c /etc/suricata/suricata.yaml -i eth0 -v

# Confirm alerts are being written:
sudo tail -f /var/log/suricata/eve.json | grep '"event_type":"alert"'`}</pre>

            <div className="kv-key" style={{ margin: '12px 0 6px' }}>
              3. Generate ONE authorised detection
            </div>
            <pre className="code">{`ping -c 2 8.8.8.8        # matches sid 1000001 -> expect: allowed`}</pre>
          </div>

          <div>
            <Notice tone="danger" title="Before any IPS test">
              An IPS drop only takes effect if the packets traverse the queue you configured. Adding a broad iptables rule is
              the fastest way to lock yourself out of the VM — and if the sensor is already in IPS mode elsewhere, restarting
              it can silently start dropping production traffic. Do this in a controlled window, over console access, with the
              queue rule removed afterwards.
            </Notice>

            <div className="kv-key" style={{ margin: '12px 0 6px' }}>
              4. Isolated IPS test (temporary, revert immediately)
            </div>
            <pre className="code">{`# a) put ONLY the sensor's own outbound ICMP into the queue
sudo iptables -I OUTPUT -p icmp -j NFQUEUE --queue-num 0

# b) run Suricata on that queue (foreground first, so you can see it)
sudo suricata -c /etc/suricata/suricata.yaml -q 0 -v

# c) in a second shell: sid 1000002 (drop to 8.8.8.8) must block
ping -c 3 8.8.8.8        # expect 100% packet loss while the rule is loaded

# d) REVERT - do this even if the test failed
sudo iptables -D OUTPUT -p icmp -j NFQUEUE --queue-num 0
sudo iptables -L OUTPUT -n --line-numbers | head    # prove it is gone
ping -c 2 8.8.8.8        # connectivity restored`}</pre>

            <div className="kv-key" style={{ margin: '12px 0 6px' }}>
              5. Prove it in the log
            </div>
            <pre className="code">{`sudo grep 1000002 /var/log/suricata/eve.json | tail -1 | python3 -m json.tool
# the record must show  alert.action = "blocked"  (or event_type = drop)
# only then may the dashboard display "blocked"`}</pre>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <Notice tone="warn" title="Rules of engagement for this test">
            <ul className="list" style={{ marginTop: 5 }}>
              <li>Only ever target addresses you are authorised to test (8.8.8.8 as ICMP echo was the approved probe here).</li>
              <li>Never add INPUT/OUTPUT-wide DROP rules — scope by protocol, port and destination.</li>
              <li>Keep IPS windows short and revert the queue rule in the same session; the project removed it after testing.</li>
              <li>
                Do not re-enable IPS simply because this dashboard is open — check the loaded rules, the traffic path and the
                firewall state first.
              </li>
            </ul>
          </Notice>
        </div>

        <div className="notice" style={{ marginTop: 12 }}>
          <span className="notice-icon">
            <IconWarning size={14} />
          </span>
          <div>
            <strong>Practical tip:</strong> after starting the sensor, hit <span className="inline-code">Refresh</span> in the
            topbar. When a new alert lands, the <em>live</em> counter on this page increments and the event appears with a{' '}
            <strong>Live</strong> badge — that is the moment the end-to-end pipeline (Suricata → EVE → API → UI) is proven.
          </div>
        </div>
      </Panel>
    </>
  );
}
