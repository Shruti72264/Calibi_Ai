/**
 * Application shell: sidebar navigation, topbar status strip and the global
 * data-source honesty banner.
 *
 * The banner is deliberately part of the shell rather than each page: whichever
 * screen an operator is on, they must be able to see whether the numbers in
 * front of them are live telemetry, historical evidence, or stale.
 */

import { NavLink, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { REFRESH_OPTIONS, WINDOW_OPTIONS, useSoc } from '../context/SocContext';
import { formatDuration, relativeTime } from '../lib/format';
import { useNow } from '../hooks/useApi';
import {
  IconActivity,
  IconAlert,
  IconGrid,
  IconInfo,
  IconList,
  IconNetwork,
  IconRadar,
  IconRefresh,
  IconRoute,
  IconSearch,
  IconShield,
  IconWarning,
  Pill,
} from './ui';

const NAV_SECTIONS: {
  label: string;
  items: { to: string; label: string; icon: typeof IconGrid }[];
}[] = [
  {
    label: 'Monitoring',
    items: [
      { to: '/', label: 'Overview', icon: IconGrid },
      { to: '/alerts', label: 'Security Alerts', icon: IconAlert },
      { to: '/ids-ips', label: 'IDS / IPS Monitoring', icon: IconRadar },
    ],
  },
  {
    label: 'Network',
    items: [
      { to: '/topology', label: 'Network Topology', icon: IconNetwork },
      { to: '/routing', label: 'Routing & Firewall', icon: IconRoute },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/investigation', label: 'Event Investigation', icon: IconSearch },
      { to: '/response', label: 'Response & Audit', icon: IconList },
      { to: '/system', label: 'System Health', icon: IconActivity },
    ],
  },
];

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/': {
    title: 'Security Operations Overview',
    subtitle: 'Suricata detections, action verdicts and source health at a glance',
  },
  '/alerts': { title: 'Security Alerts', subtitle: 'Filter, sort and page through parsed EVE alert records' },
  '/ids-ips': { title: 'IDS / IPS Monitoring', subtitle: 'Sensor state, custom rules and their real test events' },
  '/topology': {
    title: 'Network Topology',
    subtitle: 'Packet Tracer enterprise network — simulation evidence, labelled as such',
  },
  '/routing': { title: 'Routing & Firewall Status', subtitle: 'OSPF, NAT, ACL and firewall tests with their evidence source' },
  '/investigation': { title: 'Event Investigation', subtitle: 'Single-event detail, correlation, timeline and analyst notes' },
  '/response': { title: 'Response & Audit', subtitle: 'Controlled response workflow and the full action audit trail' },
  '/system': { title: 'System Health', subtitle: 'Backend, data sources, sensor probes and error states' },
};

function pageMeta(pathname: string) {
  if (pathname.startsWith('/investigation/')) {
    return { title: 'Event Investigation', subtitle: 'Single-event detail, correlation, timeline and analyst notes' };
  }
  return PAGE_META[pathname] ?? { title: 'SENTINEL SOC', subtitle: '' };
}

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const soc = useSoc();
  const now = useNow(1000);
  const meta = pageMeta(location.pathname);

  const counts = soc.health.data?.counts_by_source;
  const liveState = soc.health.data?.data_sources.find((source) => source.source === 'live')?.state ?? 'unknown';
  const historicalState =
    soc.health.data?.data_sources.find((source) => source.source === 'historical')?.state ?? 'unknown';
  const liveEvents = counts?.live ?? 0;
  const historicalEvents = counts?.historical ?? 0;

  const reachable = soc.backendReachable;
  const healthStatus = soc.health.data?.status;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <IconShield size={19} />
          </span>
          <div>
            <div className="brand-title">SENTINEL</div>
            <div className="brand-sub">Network SOC</div>
          </div>
        </div>

        <nav className="nav">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <div className="nav-group-label">{section.label}</div>
              {section.items.map((item) => {
                const Icon = item.icon;
                const isAlerts = item.to === '/alerts';
                const count = isAlerts ? (counts ? (counts.live ?? 0) + (counts.historical ?? 0) : undefined) : undefined;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  >
                    <Icon size={16} className="nav-icon" />
                    <span>{item.label}</span>
                    {count !== undefined && count > 0 && <span className="nav-count">{count}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="kv-row" style={{ gridTemplateColumns: '1fr auto', borderBottom: 'none' }}>
            <span className="kv-key">Live events</span>
            <span className="mono">{liveEvents}</span>
          </div>
          <div className="kv-row" style={{ gridTemplateColumns: '1fr auto', borderBottom: 'none' }}>
            <span className="kv-key">Historical events</span>
            <span className="mono">{historicalEvents}</span>
          </div>
          <div className="kv-row" style={{ gridTemplateColumns: '1fr auto', borderBottom: 'none' }}>
            <span className="kv-key">API</span>
            <span className={`mono ${reachable ? '' : 'faint'}`}>
              {soc.health.data?.version ?? (reachable ? '—' : 'offline')}
            </span>
          </div>
          <div className="panel-sub faint" style={{ paddingTop: 4 }}>
            Cisco data: simulation evidence only
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <h1>{meta.title}</h1>
            <div className="subtitle">{meta.subtitle}</div>
          </div>
          <div className="topbar-actions">
            <Pill tone={reachable ? (healthStatus === 'degraded' ? 'warn' : 'ok') : 'danger'} dot>
              {reachable ? (healthStatus === 'degraded' ? 'API connected · degraded' : 'API connected') : 'API unreachable'}
            </Pill>
            <span className="panel-sub faint">refreshed {relativeTime(soc.health.lastUpdated, now)}</span>

            <label className="field" style={{ gap: 0 }}>
              <select
                aria-label="Time window"
                value={soc.window}
                onChange={(event) => soc.setWindow(event.target.value)}
              >
                {WINDOW_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field" style={{ gap: 0 }}>
              <select
                aria-label="Auto refresh interval"
                value={soc.intervalMs}
                onChange={(event) => soc.setIntervalMs(Number(event.target.value))}
              >
                {REFRESH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value === 0 ? 'Auto-refresh off' : `Auto ${option.label}`}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="btn small"
              onClick={() => {
                soc.health.refresh();
                soc.system.refresh();
              }}
              disabled={soc.health.refreshing}
            >
              <IconRefresh size={13} />
              {soc.health.refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </header>

        <div className="content">
          {!reachable && (
            <div className="alert-banner danger">
              <IconWarning size={16} />
              <div>
                <strong>Backend unreachable.</strong> {soc.connectionError?.message}
              </div>
            </div>
          )}

          {reachable && liveEvents === 0 && historicalEvents > 0 && (
            <div className="alert-banner info">
              <IconInfo size={16} />
              <div>
                <strong>Showing historical evidence only.</strong> The live EVE file has no alerts right now
                (<span className="mono">{liveState}</span>), so every event below is a <em>recorded</em> test event, not
                current traffic. {soc.health.data?.data_sources.find((s) => s.source === 'live')?.detail}
              </div>
            </div>
          )}

          {reachable && liveEvents === 0 && historicalEvents === 0 && (
            <div className="alert-banner">
              <IconWarning size={16} />
              <div>
                <strong>No events available from either source.</strong> Live: <span className="mono">{liveState}</span> ·
                Historical: <span className="mono">{historicalState}</span>. Open{' '}
                <NavLink to="/system" style={{ color: '#7dd3fc' }}>
                  System Health
                </NavLink>{' '}
                for the exact file paths and reasons.
              </div>
            </div>
          )}

          {reachable && liveEvents > 0 && (
            <div className="alert-banner info">
              <IconActivity size={16} />
              <div>
                <strong>{liveEvents} live event{liveEvents === 1 ? '' : 's'} in the current EVE file</strong> from this
                sensor{historicalEvents > 0 ? `, plus ${historicalEvents} historical baseline record${historicalEvents === 1 ? '' : 's'}` : ''}
                . Each row is labelled with its source.
              </div>
            </div>
          )}

          {children}

          <footer className="panel-sub faint" style={{ paddingTop: 8, textAlign: 'center' }}>
            SENTINEL SOC v{soc.health.data?.version ?? '1.0.0'} · uptime{' '}
            {formatDuration(soc.health.data?.uptime_seconds ?? 0)} · server time{' '}
            {soc.health.data?.server_time?.slice(11, 19) ?? '—'} UTC · window: {soc.window}
          </footer>
        </div>
      </div>
    </div>
  );
}
