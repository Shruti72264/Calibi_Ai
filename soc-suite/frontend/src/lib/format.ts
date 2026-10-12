/**
 * Formatting helpers.
 *
 * Rule of thumb throughout the UI: if a value is unknown, render "—" or an
 * explicit word like "unknown". Never render a plausible-looking default.
 */

import type { Action, EvidenceStatus, Severity } from '../api/types';

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

export function formatTimeOnly(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toISOString().slice(11, 19);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

export function relativeTime(value: Date | string | null | undefined, now: Date = new Date()): string {
  if (!value) return 'never';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 0) return 'in the future';
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value === 0) return '0 B (empty)';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.floor(seconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function severityTone(severity: Severity): string {
  return severity;
}

export function actionTone(action: Action): string {
  if (action === 'blocked') return 'danger';
  if (action === 'allowed') return 'ok';
  return 'unknown';
}

export function evidenceTone(status: EvidenceStatus): string {
  switch (status) {
    case 'verified':
      return 'ok';
    case 'simulated':
      return 'info';
    case 'unavailable':
      return 'danger';
    default:
      return 'unknown';
  }
}

/** Human note for every evidence status - the legend the topology page uses. */
export const EVIDENCE_LEGEND: Record<EvidenceStatus, string> = {
  verified: 'Confirmed in the operator’s own CLI/test session',
  simulated: 'Present in the saved Packet Tracer topology; no CLI capture taken',
  unknown: 'No evidence available either way',
  unavailable: 'Attempted or required, but not achievable in this lab',
};

export function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

export function portLabel(ip: string | null, port: number | null): string {
  if (!ip) return '—';
  return port === null || port === undefined ? ip : `${ip}:${port}`;
}

/** CSV export of the currently filtered alert list (client-side, no backend write). */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = columns.join(',');
  const body = rows.map((row) => columns.map((column) => escape(row[column])).join(','));
  return [header, ...body].join('\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
