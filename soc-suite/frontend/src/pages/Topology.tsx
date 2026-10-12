/**
 * Network Topology - the Cisco/Packet Tracer estate.
 *
 * Hard rule implemented here: this page renders NO real-time interface state.
 * It renders the operator's verified evidence, with every device and link
 * carrying a data-class label (verified / simulated / unknown / unavailable) that
 * comes from the evidence pack, not from a guess.
 */

import { useMemo, useState } from 'react';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { EVIDENCE_LEGEND, titleCase } from '../lib/format';
import type { EvidenceStatus, NetworkDevice } from '../api/types';
import {
  Bars,
  ErrorState,
  EvidenceBadge,
  IconInfo,
  KeyValue,
  LoadingState,
  Notice,
  Panel,
  Pill,
  StatCard,
} from '../components/ui';

const STATUS_COLOR: Record<EvidenceStatus, string> = {
  verified: '#22c55e',
  simulated: '#38bdf8',
  unknown: '#64748b',
  unavailable: '#ef4444',
};

const KIND_ICON: Record<string, string> = {
  router: 'R',
  switch: 'SW',
  firewall: 'FW',
  server: 'SRV',
  client: 'PC',
};

const NODE_W = 142;
const NODE_H = 56;
const BAND_W = 316;
const BAND_GAP = 14;

interface Positioned {
  device: NetworkDevice;
  x: number;
  y: number;
}

export default function Topology() {
  const network = useApi(({ signal }) => api.network({ signal }), [], { intervalMs: 30000 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const data = network.data;

  const layout = useMemo(() => {
    if (!data) return { nodes: [] as Positioned[], height: 480, bands: [] as { id: string; x: number; w: number; title: string }[] };
    const bands = data.sites.map((site, index) => ({
      id: site.id,
      x: 18 + index * (BAND_W + BAND_GAP),
      w: BAND_W,
      title: site.name,
    }));

    const nodes: Positioned[] = [];
    let maxRows = 1;
    data.sites.forEach((site, index) => {
      const devices = data.devices.filter((device) => device.site === site.id);
      const perRow = devices.length > 6 ? 2 : 1;
      devices.forEach((device, deviceIndex) => {
        const row = Math.floor(deviceIndex / perRow);
        const column = deviceIndex % perRow;
        const innerWidth = BAND_W - 28;
        const slot = innerWidth / perRow;
        nodes.push({
          device,
          x: bands[index].x + 14 + column * slot + (slot - NODE_W) / 2,
          y: 74 + row * (NODE_H + 20),
        });
      });
      maxRows = Math.max(maxRows, Math.ceil(devices.length / perRow));
    });

    return { nodes, height: 100 + maxRows * (NODE_H + 20), bands };
  }, [data]);

  const selected = data?.devices.find((device) => device.id === selectedId) ?? null;
  const selectedEvidence =
    data && selected ? data.evidence.filter((item) => selected.evidence_refs.includes(item.id)) : [];

  const positionOf = (id: string) => layout.nodes.find((node) => node.device.id === id);

  if (network.loading && !data) {
    return (
      <Panel title="Loading network evidence…">
        <LoadingState rows={6} />
      </Panel>
    );
  }

  if (network.error && !data) {
    return (
      <Panel title="Network evidence unavailable">
        <ErrorState
          title="Could not load /api/network/status"
          detail={network.error.message}
          onRetry={network.refresh}
        />
      </Panel>
    );
  }

  if (!data) return null;

  if (!data.evidence_pack.available) {
    return (
      <Panel title="Evidence pack not loaded">
        <ErrorState
          title="The Cisco evidence pack is missing or invalid"
          detail={data.evidence_pack.error ?? 'unknown error'}
          meta="Restore soc-suite/backend/data/cisco/network_evidence.json or point SOC_CISCO_EVIDENCE_PATH at your own pack."
          onRetry={network.refresh}
        />
      </Panel>
    );
  }

  const byStatus = data.devices.reduce<Record<string, number>>((accumulator, device) => {
    accumulator[device.evidence_status] = (accumulator[device.evidence_status] ?? 0) + 1;
    return accumulator;
  }, {});

  return (
    <>
      <Notice tone="warn" title="Data class: simulation evidence — not live telemetry">
        {data.disclosure}
        <div className="small" style={{ marginTop: 6 }}>
          Packet Tracer devices in this topology generally do not serve SSH/SNMP to external collectors, so{' '}
          {data.live_collection.enabled ? 'the live adapter is enabled and probes below' : 'the live adapter is off'} —
          interface counters, uptime and per-port status are deliberately absent rather than fabricated.
        </div>
      </Notice>

      <div className="grid stats">
        <StatCard label="Devices documented" value={data.devices.length} foot={`${data.sites.length} logical sites`} />
        <StatCard label="Links documented" value={data.links.length} foot="medium + addressing recorded" />
        <StatCard label="Verified devices" value={byStatus.verified ?? 0} tone="ok" foot="CLI/test evidence exists" />
        <StatCard label="Simulated only" value={byStatus.simulated ?? 0} tone="info" foot="in topology, no CLI capture" />
        <StatCard label="Evidence items" value={data.evidence.length} foot="tests and configuration checks" />
        <StatCard
          label="Live collection"
          value={data.live_collection.enabled ? 'enabled' : 'off'}
          tone="warn"
          small
          foot={data.live_collection.enabled ? `${data.live_collection.probes.length} probe(s)` : 'evidence mode'}
        />
      </div>

      <div className="grid split">
        <Panel
          title="Enterprise topology"
          subtitle="Click any device for its recorded addresses, services and evidence"
          actions={
            <>
              {(Object.keys(STATUS_COLOR) as EvidenceStatus[]).map((status) => (
                <span key={status} className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: STATUS_COLOR[status], display: 'inline-block' }} />
                  {status}
                </span>
              ))}
            </>
          }
        >
          <div className="topology">
            <svg viewBox={`0 0 ${18 * 2 + layout.bands.length * (BAND_W + BAND_GAP)} ${layout.height}`} role="img" aria-label="Network topology diagram">
              {layout.bands.map((band) => (
                <g key={band.id}>
                  <rect className="site-band" x={band.x} y={16} width={band.w} height={layout.height - 32} rx={10} />
                  <text className="site-title" x={band.x + 14} y={40}>
                    {band.title}
                  </text>
                </g>
              ))}

              {data.links.map((link) => {
                const a = positionOf(link.a);
                const b = positionOf(link.b);
                if (!a || !b) return null;
                const x1 = a.x + NODE_W / 2;
                const y1 = a.y + NODE_H / 2;
                const x2 = b.x + NODE_W / 2;
                const y2 = b.y + NODE_H / 2;
                const color = STATUS_COLOR[link.status];
                return (
                  <g key={link.id}>
                    <line
                      className="link-line"
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={color}
                      strokeOpacity={0.75}
                      strokeDasharray={link.status === 'verified' ? undefined : '5 4'}
                    />
                    <text className="link-label" x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} textAnchor="middle">
                      {link.medium}
                    </text>
                  </g>
                );
              })}

              {layout.nodes.map(({ device, x, y }) => {
                const color = STATUS_COLOR[device.evidence_status];
                const isSelected = device.id === selectedId;
                return (
                  <g
                    key={device.id}
                    className="topo-node"
                    transform={`translate(${x},${y})`}
                    onClick={() => setSelectedId(isSelected ? null : device.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') setSelectedId(isSelected ? null : device.id);
                    }}
                  >
                    <rect
                      width={NODE_W}
                      height={NODE_H}
                      rx={7}
                      fill={isSelected ? '#1a2740' : '#101a29'}
                      stroke={color}
                      strokeWidth={isSelected ? 2 : 1.3}
                    />
                    <rect width={4} height={NODE_H} rx={2} fill={color} />
                    <text className="topo-label" x={12} y={21}>
                      {KIND_ICON[device.kind] ?? '??'} · {device.name.length > 19 ? `${device.name.slice(0, 18)}…` : device.name}
                    </text>
                    <text className="topo-sublabel" x={12} y={36}>
                      {device.addresses[0]?.ip ?? 'no address recorded'}
                      {device.addresses.length > 1 ? ` +${device.addresses.length - 1}` : ''}
                    </text>
                    <text className="topo-sublabel" x={12} y={48} fill={color}>
                      {device.evidence_status}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="panel-sub faint" style={{ marginTop: 8 }}>
            Solid line = verified link · dashed = present in the saved topology without a CLI capture. Node stripe colour shows
            the evidence status. No live interface state is displayed because none is measured.
          </div>
        </Panel>

        <div className="grid" style={{ gap: 14, alignContent: 'start' }}>
          {selected ? (
            <Panel
              title={selected.name}
              subtitle={`${titleCase(selected.kind)} · ${data.sites.find((site) => site.id === selected.site)?.name ?? selected.site}`}
              actions={<EvidenceBadge status={selected.evidence_status} />}
            >
              <div className="notice" style={{ marginBottom: 11 }}>
                <div>{selected.evidence_note ?? EVIDENCE_LEGEND[selected.evidence_status]}</div>
              </div>
              <div className="kv-key" style={{ marginBottom: 4 }}>
                Addresses as configured
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Interface</th>
                      <th>Address</th>
                      <th>Mask</th>
                      <th>Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.addresses.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="faint">
                          No IP addresses recorded for this device.
                        </td>
                      </tr>
                    ) : (
                      selected.addresses.map((address) => (
                        <tr key={`${address.interface}-${address.ip}`}>
                          <td className="mono">{address.interface}</td>
                          <td className="mono cell-strong">{address.ip}</td>
                          <td className="mono faint">{address.mask ?? '—'}</td>
                          <td className="small">{address.role}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 11 }}>
                <div className="kv-key" style={{ marginBottom: 4 }}>
                  Services / roles configured
                </div>
                <div className="chip-group">
                  {selected.services.length === 0 ? (
                    <span className="faint small">none recorded</span>
                  ) : (
                    selected.services.map((service) => (
                      <span className="tag" key={service}>
                        {service}
                      </span>
                    ))
                  )}
                </div>
              </div>
              {selectedEvidence.length > 0 && (
                <div style={{ marginTop: 11 }}>
                  <div className="kv-key" style={{ marginBottom: 4 }}>
                    Backing evidence
                  </div>
                  <ul className="list small">
                    {selectedEvidence.map((item) => (
                      <li key={item.id}>
                        <span className="mono">{item.id}</span> — {item.title} <Pill tone="ok">{item.result}</Pill>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Panel>
          ) : (
            <Panel title="Device details" subtitle="Nothing selected">
              <div className="panel-sub">
                Select a device in the diagram to see its recorded interfaces, addresses, services and the evidence that
                backs each claim.
              </div>
            </Panel>
          )}

          <Panel title="Evidence status legend" subtitle="What each label means in this project">
            <div className="grid" style={{ gap: 9 }}>
              {(Object.keys(EVIDENCE_LEGEND) as EvidenceStatus[]).map((status) => (
                <div key={status} className="kv-row" style={{ gridTemplateColumns: '110px 1fr' }}>
                  <div>
                    <EvidenceBadge status={status} />
                  </div>
                  <div className="small">{EVIDENCE_LEGEND[status]}</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Verification coverage" subtitle="How much of the topology is actually proven">
            <Bars
              data={(Object.keys(byStatus) as string[]).map((status) => ({
                key: status,
                count: byStatus[status],
                percent: Math.round((byStatus[status] / data.devices.length) * 1000) / 10,
              }))}
              tone="info"
            />
            <div className="panel-sub" style={{ marginTop: 10 }}>
              Evidence pack <span className="mono">{data.evidence_pack.pack_id ?? '—'}</span> v
              {data.evidence_pack.version ?? '—'} · source: {data.evidence_pack.source_system ?? 'unknown'}
            </div>
            {data.evidence_pack.generated_at_note && (
              <div className="panel-sub faint">{data.evidence_pack.generated_at_note}</div>
            )}
          </Panel>
        </div>
      </div>

      <div className="grid cols-2">
        <Panel title="Addressing plan" subtitle="Recorded segments">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Segment</th>
                  <th>Prefix</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {(data.evidence_pack.addressing_plan ?? []).map((row) => (
                  <tr key={row.cidr + row.segment}>
                    <td>{row.segment}</td>
                    <td className="mono cell-strong">{row.cidr}</td>
                    <td className="small dim">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title="Links"
          subtitle="Logical connections with their evidence status"
          actions={<Pill tone={(data.provider_mode === 'evidence' ? 'info' : 'ok') as 'info' | 'ok'}>{data.provider_mode} mode</Pill>}
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Link</th>
                  <th>Medium</th>
                  <th>Addresses</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.links.map((link) => {
                  const a = data.devices.find((device) => device.id === link.a);
                  const b = data.devices.find((device) => device.id === link.b);
                  return (
                    <tr key={link.id}>
                      <td className="small">
                        {a?.name ?? link.a} ↔ {b?.name ?? link.b}
                        {link.evidence_note && <div className="faint small">{link.evidence_note}</div>}
                      </td>
                      <td className="mono small">{link.medium}</td>
                      <td className="mono small faint">{link.addresses.join(' ↔ ') || '—'}</td>
                      <td>
                        <EvidenceBadge status={link.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel
        title="Live collection attempt"
        subtitle="What the adapter actually probed, and what it refused to claim"
      >
        <div className="grid cols-2" style={{ gap: 14 }}>
          <KeyValue
            rows={[
              { key: 'Adapter', value: <span className="mono">{data.live_collection.adapter}</span> },
              { key: 'Enabled', value: String(data.live_collection.enabled) },
              { key: 'Devices support telemetry', value: String(data.live_collection.supported_by_devices) },
              { key: 'Checked at', value: <span className="mono">{data.live_collection.checked_at}</span> },
            ]}
          />
          <div>
            <div className="notice info">
              <span className="notice-icon">
                <IconInfo size={14} />
              </span>
              <div>{data.live_collection.note}</div>
            </div>
            {data.live_collection.probes.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Target</th>
                      <th>Port</th>
                      <th>Reachable</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.live_collection.probes.map((probe) => (
                      <tr key={probe.target}>
                        <td className="mono">{probe.host}</td>
                        <td className="mono">{probe.port}</td>
                        <td>
                          {probe.reachable ? <Pill tone="ok">yes</Pill> : <Pill tone="danger">no</Pill>}
                        </td>
                        <td className="small dim">{probe.error ?? 'TCP connect succeeded (no login performed)'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </Panel>
    </>
  );
}
