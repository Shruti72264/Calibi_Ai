/**
 * Shared presentational components.
 *
 * Everything here is intentionally dumb: no data fetching, no hidden state, so
 * a page can always be read top-to-bottom and reasoned about.
 */

import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AnalystStatus, Distribution, EvidenceStatus, Severity } from '../api/types';
import { actionTone, evidenceTone, formatTimestamp, relativeTime, titleCase } from '../lib/format';

/* ------------------------------------------------------------------ icons */
type IconProps = { size?: number; className?: string };

const svg = (path: ReactNode, extra?: { fill?: boolean }) =>
  function Icon({ size = 16, className }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={extra?.fill ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {path}
      </svg>
    );
  };

export const IconShield = svg(<path d="M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z" />);
export const IconGrid = svg(
  <>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.4" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.4" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.4" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.4" />
  </>,
);
export const IconAlert = svg(
  <>
    <path d="M10.3 3.9L1.9 18a2 2 0 001.7 3h16.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </>,
);
export const IconNetwork = svg(
  <>
    <rect x="9" y="2.5" width="6" height="6" rx="1.4" />
    <rect x="2" y="15.5" width="6" height="6" rx="1.4" />
    <rect x="16" y="15.5" width="6" height="6" rx="1.4" />
    <path d="M12 8.5v3.5M5 15.5v-2a1.5 1.5 0 011.5-1.5h11A1.5 1.5 0 0119 13.5v2" />
  </>,
);
export const IconRoute = svg(
  <>
    <circle cx="6" cy="19" r="2.6" />
    <circle cx="18" cy="5" r="2.6" />
    <path d="M8.6 19H14a3 3 0 000-6h-4a3 3 0 010-6h5.4" />
  </>,
);
export const IconRadar = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 12l6-6" />
  </>,
);
export const IconSearch = svg(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </>,
);
export const IconActivity = svg(<path d="M3 12h3.5l2.5-7 4 14 2.5-7H21" />);
export const IconList = svg(
  <>
    <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </>,
);
export const IconRefresh = svg(
  <>
    <path d="M20 11a8 8 0 10-2.3 5.7" />
    <path d="M20 5v6h-6" />
  </>,
);
export const IconDownload = svg(
  <>
    <path d="M12 3v12M7.5 10.5L12 15l4.5-4.5" />
    <path d="M4 20h16" />
  </>,
);
export const IconInfo = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </>,
);
export const IconWarning = svg(
  <>
    <path d="M10.3 3.9L1.9 18a2 2 0 001.7 3h16.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </>,
);
export const IconCheck = svg(<path d="M4 12.5l5 5L20 6.5" />);
export const IconX = svg(<path d="M6 6l12 12M18 6L6 18" />);
export const IconBack = svg(
  <>
    <path d="M19 12H5" />
    <path d="M11 6l-6 6 6 6" />
  </>,
);
export const IconClock = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3.5 2" />
  </>,
);

/* ----------------------------------------------------------------- panels */
export function Panel({
  title,
  subtitle,
  actions,
  children,
  flush = false,
  className = '',
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`panel ${className}`} id={id}>
      {(title || actions) && (
        <header className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <div className="panel-sub">{subtitle}</div>}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      <div className={`panel-body ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  foot,
  tone = '',
  small = false,
}: {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
  tone?: '' | 'ok' | 'warn' | 'danger' | 'info';
  small?: boolean;
}) {
  return (
    <div className={`stat ${tone ? `tone-${tone}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${small ? 'small-value' : ''}`}>{value}</div>
      {foot !== undefined && <div className="stat-foot">{foot}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ pills */
export function Pill({
  tone = '',
  children,
  dot = false,
}: {
  tone?: '' | 'ok' | 'warn' | 'danger' | 'info' | 'accent' | 'unknown';
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span className={`pill ${tone}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const tone = severity === 'high' ? 'danger' : severity === 'medium' ? 'warn' : severity === 'low' ? 'ok' : 'unknown';
  return <Pill tone={tone as 'danger' | 'warn' | 'ok' | 'unknown'}>{severity.toUpperCase()}</Pill>;
}

export function ActionBadge({ action }: { action: string }) {
  const tone = actionTone(action as 'allowed' | 'blocked' | 'unknown');
  return (
    <Pill tone={tone as 'ok' | 'danger' | 'unknown'} dot>
      {action}
    </Pill>
  );
}

export function SourceBadge({ source }: { source: 'live' | 'historical' }) {
  return source === 'live' ? (
    <Pill tone="info" dot>
      Live
    </Pill>
  ) : (
    <Pill tone="accent">Historical evidence</Pill>
  );
}

export function EvidenceBadge({ status }: { status: EvidenceStatus }) {
  const tone = evidenceTone(status) as 'ok' | 'info' | 'danger' | 'unknown';
  return <Pill tone={tone}>{status}</Pill>;
}

export function AnalystBadge({ status }: { status: AnalystStatus }) {
  const tone =
    status === 'resolved' ? 'ok' : status === 'investigating' ? 'warn' : status === 'false_positive' ? 'unknown' : 'info';
  return <Pill tone={tone as 'ok' | 'warn' | 'unknown' | 'info'}>{titleCase(status)}</Pill>;
}

/* -------------------------------------------------------------- notices */
export function Notice({
  tone = 'info',
  title,
  children,
  icon,
}: {
  tone?: 'info' | 'warn' | 'danger' | 'ok';
  title?: ReactNode;
  children?: ReactNode;
  icon?: ComponentType<IconProps>;
}) {
  const Icon: ComponentType<IconProps> = icon ?? (tone === 'danger' || tone === 'warn' ? IconWarning : IconInfo);
  return (
    <div className={`notice ${tone}`}>
      <span className="notice-icon">
        <Icon size={15} />
      </span>
      <div>
        {title && <div className="notice-title">{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- states */
export function LoadingState({ rows = 3, label }: { rows?: number; label?: string }) {
  return (
    <div style={{ padding: '6px 2px' }} aria-busy="true" aria-live="polite">
      {label && <div className="panel-sub" style={{ marginBottom: 8 }}>{label}</div>}
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton" style={{ width: `${100 - index * 12}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <span className="state-icon">
        <IconSearch size={22} />
      </span>
      <div className="state-title">{title}</div>
      {detail && <div className="state-detail">{detail}</div>}
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Data unavailable',
  detail,
  onRetry,
  meta,
}: {
  title?: string;
  detail: ReactNode;
  onRetry?: () => void;
  meta?: ReactNode;
}) {
  return (
    <div className="state error">
      <span className="state-icon">
        <IconWarning size={22} />
      </span>
      <div className="state-title">{title}</div>
      <div className="state-detail">{detail}</div>
      {meta && <div className="state-detail faint small">{meta}</div>}
      {onRetry && (
        <button type="button" className="btn small" onClick={onRetry}>
          <IconRefresh size={13} /> Retry
        </button>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- charts */
const SEVERITY_COLORS: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#22c55e',
  unknown: '#64748b',
};
const ACTION_COLORS: Record<string, string> = {
  blocked: '#ef4444',
  allowed: '#22c55e',
  unknown: '#64748b',
};

export function Donut({
  data,
  palette,
  centerLabel,
  size = 138,
}: {
  data: Distribution[];
  palette: Record<string, string>;
  centerLabel: string;
  size?: number;
}) {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  const radius = size / 2 - 12;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  if (total === 0) {
    return (
      <div className="donut-wrap">
        <div className="chart-empty" style={{ width: size }}>
          no events in scope
        </div>
      </div>
    );
  }

  return (
    <div className="donut-wrap">
      <div className="donut" style={{ width: size, height: size }}>
        <svg width={size} height={size} role="img" aria-label={`${centerLabel} distribution`}>
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#162033" strokeWidth={13} />
            {data.map((item) => {
              const length = (item.count / total) * circumference;
              const dash = `${length} ${circumference - length}`;
              const element = (
                <circle
                  key={item.key}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={palette[item.key] ?? '#3b82f6'}
                  strokeWidth={13}
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                />
              );
              offset += length;
              return element;
            })}
          </g>
        </svg>
        <div className="donut-center">
          <div className="value">{total}</div>
          <div className="label">{centerLabel}</div>
        </div>
      </div>
      <div className="legend">
        {data.map((item) => (
          <div className="legend-item" key={item.key}>
            <span className="legend-swatch" style={{ background: palette[item.key] ?? '#3b82f6' }} />
            <span>{titleCase(item.key)}</span>
            <span className="legend-value">
              {item.count} · {item.percent}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SeverityDonut({ data, size }: { data: Distribution[]; size?: number }) {
  return <Donut data={data} palette={SEVERITY_COLORS} centerLabel="events" size={size} />;
}

export function ActionDonut({ data, size }: { data: Distribution[]; size?: number }) {
  return <Donut data={data} palette={ACTION_COLORS} centerLabel="events" size={size} />;
}

export function Bars({
  data,
  tone = 'info',
  limit,
  emptyLabel = 'no data',
  formatKey,
}: {
  data: Distribution[];
  tone?: '' | 'ok' | 'warn' | 'danger' | 'info';
  limit?: number;
  emptyLabel?: string;
  formatKey?: (key: string) => string;
}) {
  const rows = limit ? data.slice(0, limit) : data;
  if (rows.length === 0) {
    return <div className="chart-empty">{emptyLabel}</div>;
  }
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <div className="bars">
      {rows.map((row) => (
        <div className="bar-row" key={row.key}>
          <span className="bar-label" title={row.key}>
            {formatKey ? formatKey(row.key) : row.key}
          </span>
          <span className="bar-track">
            <span
              className={`bar-fill ${tone}`}
              style={{ width: `${Math.max((row.count / max) * 100, 2)}%` }}
            />
          </span>
          <span className="bar-value">
            {row.count} · {row.percent}%
          </span>
        </div>
      ))}
    </div>
  );
}

export function TimelineChart({
  data,
}: {
  data: { bucket: string; total: number; blocked: number; allowed: number; unknown: number }[];
}) {
  if (data.length === 0) {
    return <div className="chart-empty">no events in the selected window</div>;
  }
  const width = 760;
  const height = 96;
  const max = Math.max(...data.map((point) => point.total), 1);
  const step = data.length > 1 ? width / (data.length - 1) : width;

  const points = data.map((point, index) => {
    const x = data.length > 1 ? index * step : width / 2;
    const y = height - (point.total / max) * (height - 12) - 6;
    return { x, y, ...point };
  });

  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area = `${line} L${points[points.length - 1].x.toFixed(1)},${height} L${points[0].x.toFixed(1)},${height} Z`;
  const first = data[0].bucket;
  const last = data[data.length - 1].bucket;

  return (
    <div>
      <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Alert volume over time">
        <defs>
          <linearGradient id="timeline-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1={0}
            x2={width}
            y1={height * fraction}
            y2={height * fraction}
            stroke="#162033"
            strokeWidth={1}
          />
        ))}
        <path d={area} fill="url(#timeline-fill)" />
        <path d={line} fill="none" stroke="#38bdf8" strokeWidth={1.8} />
        {points.map((point) =>
          point.blocked > 0 ? (
            <circle key={point.bucket} cx={point.x} cy={point.y} r={3} fill="#ef4444" stroke="#0d1420" strokeWidth={1.4} />
          ) : null,
        )}
      </svg>
      <div className="panel-sub" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span>{formatTimestamp(first)}</span>
        <span className="faint">total per bucket · red marker = blocked events</span>
        <span>{formatTimestamp(last)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ misc */
export function KeyValue({ rows }: { rows: { key: ReactNode; value: ReactNode }[] }) {
  return (
    <div className="kv">
      {rows.map((row, index) => (
        <div className="kv-row" key={index}>
          <div className="kv-key">{row.key}</div>
          <div className="kv-val">{row.value}</div>
        </div>
      ))}
    </div>
  );
}

export function DataSourceStrip({
  live,
  historical,
  liveState,
  historicalState,
}: {
  live: number;
  historical: number;
  liveState: string;
  historicalState: string;
}) {
  return (
    <div className="grid cols-2" style={{ gap: 10 }}>
      <div className="notice" style={{ alignItems: 'center' }}>
        <span className="notice-icon">
          <IconActivity size={15} />
        </span>
        <div>
          <div className="notice-title">
            Live sensor telemetry — <strong>{live}</strong> event{live === 1 ? '' : 's'}
          </div>
          <div className="small dim">
            Read from the EVE file just now · source state: <span className="mono">{liveState}</span>
          </div>
        </div>
      </div>
      <div className="notice" style={{ alignItems: 'center' }}>
        <span className="notice-icon">
          <IconClock size={15} />
        </span>
        <div>
          <div className="notice-title">
            Historical baseline evidence — <strong>{historical}</strong> event{historical === 1 ? '' : 's'}
          </div>
          <div className="small dim">
            Recorded earlier, replayed from the evidence file · source state:{' '}
            <span className="mono">{historicalState}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function EventLink({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Link to={`/investigation/${encodeURIComponent(id)}`} className="mono" style={{ color: '#7dd3fc' }}>
      {children}
    </Link>
  );
}

export function LastUpdated({ at, extra }: { at: Date | null; extra?: string }) {
  return (
    <span className="panel-sub faint">
      {extra ? `${extra} · ` : ''}updated {relativeTime(at)}
    </span>
  );
}
