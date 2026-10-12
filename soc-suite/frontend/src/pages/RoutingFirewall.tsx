/**
 * Routing & Firewall Status.
 *
 * This page exists to make one distinction impossible to miss:
 * these are SAVED TEST RESULTS from a verification session, not a live poll of
 * the devices. Each card states its evidence source and its verification time
 * (including "not recorded" when the operator did not capture one, rather than
 * substituting today's date).
 */

import { useMemo, useState } from 'react';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { formatTimestamp, titleCase } from '../lib/format';
import { EVIDENCE_LEGEND } from '../lib/format';
import type { EvidenceItem, EvidenceStatus } from '../api/types';
import {
  EvidenceBadge,
  ErrorState,
  IconInfo,
  KeyValue,
  LoadingState,
  Notice,
  Panel,
  Pill,
  StatCard,
} from '../components/ui';

const AREA_TITLES: Record<string, string> = {
  routing: 'Dynamic routing (OSPF)',
  dhcp: 'Address assignment (DHCP)',
  dns_http: 'Name resolution and web services',
  firewall_nat: 'Firewall and address translation',
  acl: 'Access control lists',
  wan: 'Wide-area link',
  vpn_limitation: 'Site-to-site VPN (not completed)',
  simulation_boundary: 'Simulation boundary (architecture rule)',
};

const RESULT_TONE = (result: string): 'ok' | 'danger' | 'warn' | 'info' =>
  result === 'PASS' ? 'ok' : result === 'FAIL' ? 'danger' : result === 'NOT COMPLETED' ? 'danger' : 'info';

export default function RoutingFirewall() {
  const network = useApi(({ signal }) => api.network({ signal }), [], { intervalMs: 60000 });
  const [area, setArea] = useState<string>('all');

  const evidence = network.data?.evidence ?? [];
  const areas = useMemo(() => {
    const unique = Array.from(new Set(evidence.map((item) => item.area)));
    return ['all', ...unique];
  }, [evidence]);

  const filtered = area === 'all' ? evidence : evidence.filter((item) => item.area === area);

  if (network.loading && !network.data) {
    return (
      <Panel title="Loading routing and firewall evidence…">
        <LoadingState rows={5} />
      </Panel>
    );
  }

  if (network.error && !network.data) {
    return (
      <Panel title="Evidence unavailable">
        <ErrorState detail={network.error.message} onRetry={network.refresh} />
      </Panel>
    );
  }

  const passCount = evidence.filter((item) => item.result === 'PASS').length;
  const notCompleted = evidence.filter((item) => item.result === 'NOT COMPLETED');
  const missingDates = evidence.filter((item) => !item.verified_at).length;

  return (
    <>
      <Notice tone="warn" title="Saved verification evidence — not current device telemetry">
        Every row below was captured during the operator's own CLI/test session and stored in the evidence pack. The
        platform cannot poll these Packet Tracer devices, so nothing here is labelled "up now". Where a verification
        timestamp was not recorded, the entry says so.
      </Notice>

      <div className="grid stats">
        <StatCard label="Checks recorded" value={evidence.length} foot="routing, DHCP, DNS, NAT, ACL, WAN" />
        <StatCard label="Passed" value={passCount} tone="ok" foot="verified in the CLI session" />
        <StatCard
          label="Not completed"
          value={notCompleted.length}
          tone={notCompleted.length ? 'danger' : ''}
          foot="documented limitations"
        />
        <StatCard
          label="Timestamps missing"
          value={missingDates}
          tone={missingDates ? 'warn' : 'ok'}
          foot="shown as 'not recorded'"
        />
      </div>

      <Panel
        title="Evidence by area"
        subtitle="Grouped the way the original verification work was carried out"
        actions={
          <div className="chip-group">
            {areas.map((option) => (
              <button
                type="button"
                key={option}
                className={`chip ${area === option ? 'active' : ''}`}
                onClick={() => setArea(option)}
              >
                {option === 'all' ? 'All areas' : titleCase(option)}
              </button>
            ))}
          </div>
        }
      >
        <div className="grid cols-2">
          {filtered.map((item) => (
            <div className="panel" key={item.id} style={{ background: 'var(--bg-panel-2)' }}>
              <div className="panel-head">
                <div>
                  <h3>{item.title}</h3>
                  <div className="panel-sub">
                    {AREA_TITLES[item.area] ?? titleCase(item.area)} · <span className="mono">{item.id}</span>
                  </div>
                </div>
                <div className="panel-actions">
                  <Pill tone={RESULT_TONE(item.result)}>{item.result}</Pill>
                  <EvidenceBadge status={item.status} />
                </div>
              </div>
              <div className="panel-body">
                <div className="small" style={{ marginBottom: 10 }}>
                  {item.detail}
                </div>
                <KeyValue
                  rows={[
                    {
                      key: 'Verified at',
                      value: item.verified_at ? (
                        <span className="mono">{formatTimestamp(item.verified_at)}</span>
                      ) : (
                        <span className="faint">{item.verified_at_note ?? 'not recorded'}</span>
                      ),
                    },
                    { key: 'Evidence source', value: <span className="mono small">{item.source}</span> },
                    ...(item.command
                      ? [{ key: 'Key configuration', value: <span className="mono small">{item.command}</span> }]
                      : []),
                    ...(item.expected ? [{ key: 'Expected', value: <span className="small">{item.expected}</span> }] : []),
                    ...(item.observed ? [{ key: 'Observed', value: <span className="small">{item.observed}</span> }] : []),
                  ]}
                />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Full evidence table" subtitle="The same records in a form you can paste into a report" flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>ID</th>
                <th>Area</th>
                <th>Check</th>
                <th>Result</th>
                <th>Status</th>
                <th>Verified at</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((item: EvidenceItem) => (
                <tr key={item.id}>
                  <td className="mono">{item.id}</td>
                  <td className="small">{AREA_TITLES[item.area] ?? item.area}</td>
                  <td>{item.title}</td>
                  <td>
                    <Pill tone={RESULT_TONE(item.result)}>{item.result}</Pill>
                  </td>
                  <td>
                    <EvidenceBadge status={item.status} />
                  </td>
                  <td className="mono small">
                    {item.verified_at ?? <span className="faint">not recorded</span>}
                  </td>
                  <td className="mono small dim">{item.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid cols-2">
        <Panel title="What was actually proven" subtitle="Read this before quoting the dashboard">
          <ul className="list">
            <li>
              <strong>OSPF:</strong> adjacency formed and the Branch prefix was learned by R1 — this proves the serial WAN
              forwards traffic and convergence works, not that a specific interface is up right now.
            </li>
            <li>
              <strong>DHCP:</strong> R1 issued leases on 192.168.10.0/24 to clients.
            </li>
            <li>
              <strong>DNS/HTTP/HTTPS:</strong> www.securetech.local resolved to 192.168.20.10 and the internal site loaded
              over both schemes.
            </li>
            <li>
              <strong>ASA NAT/PAT:</strong> inside hosts were translated and reached the simulated Internet server; unsolicited
              outside-to-inside traffic was refused.
            </li>
            <li>
              <strong>ACL BLOCK_PC0:</strong> PC0 (192.168.10.13) could not reach 203.0.114.10 while other clients and
              destinations were unaffected — the negative test and its positive control.
            </li>
            <li>
              <strong>Serial WAN:</strong> Serial0/3/0 verified up/up on R1 and R2 (10.10.10.0/30).
            </li>
          </ul>
        </Panel>

        <div className="grid" style={{ gap: 14, alignContent: 'start' }}>
          <Panel title="Known limitations" subtitle="Stated plainly, because honesty is part of the deliverable">
            <div className="grid" style={{ gap: 9 }}>
              {notCompleted.map((item) => (
                <div className="notice danger" key={item.id}>
                  <span className="notice-icon">
                    <IconInfo size={14} />
                  </span>
                  <div>
                    <div className="notice-title">{item.title}</div>
                    <div className="small">{item.detail}</div>
                  </div>
                </div>
              ))}
              <div className="notice">
                <span className="notice-icon">
                  <IconInfo size={14} />
                </span>
                <div>
                  <div className="notice-title">No live device polling</div>
                  <div className="small">
                    Packet Tracer offers no management plane to this dashboard. Treat this page as a signed-off test log,
                    and re-run the CLI checks on the real topology whenever you need current state.
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Evidence status vocabulary" subtitle="Consistent with the topology page">
            <div className="grid" style={{ gap: 8 }}>
              {(Object.keys(EVIDENCE_LEGEND) as EvidenceStatus[]).map((status) => (
                <div className="kv-row" key={status} style={{ gridTemplateColumns: '110px 1fr' }}>
                  <div>
                    <EvidenceBadge status={status} />
                  </div>
                  <div className="small">{EVIDENCE_LEGEND[status]}</div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
