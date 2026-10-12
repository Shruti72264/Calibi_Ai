/**
 * Minimal, dependency-free API client.
 *
 * * Base URL is EMPTY by default so every request is same-origin and travels
 *   through the Vite proxy. Set VITE_API_BASE_URL only when the API lives
 *   somewhere else, and remember to add that origin to SOC_CORS_ORIGINS.
 * * Errors are surfaced as a typed ApiError carrying the backend's message, so
 *   the UI can print the real reason instead of "something went wrong".
 */

import type {
  AlertListResponse,
  AuditEntry,
  EventDetail,
  HealthResponse,
  NetworkStatus,
  ResponseActionResult,
  ResponseStatus,
  StatsResponse,
  SystemStatus,
} from './types';

const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly isNetworkError: boolean;

  constructor(message: string, status: number, path: string, isNetworkError = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.path = path;
    this.isNetworkError = isNetworkError;
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Optional key for mutating calls; server rejects writes without it. */
  apiKey?: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Server-side cache bypass (re-reads the log files). */
  force?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = `${BASE}${path}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.apiKey) headers['X-API-Key'] = options.apiKey;

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      credentials: 'omit',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      `Cannot reach the SENTINEL SOC API at ${url}. Is the backend running? ` +
        `Start it with: cd soc-suite/backend && ./run-backend.sh`,
      0,
      path,
      true,
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && 'detail' in payload
        ? String((payload as { detail: unknown }).detail)
        : text.slice(0, 300) || response.statusText;
    throw new ApiError(detail, response.status, path);
  }

  return payload as T;
}

// --------------------------------------------------------------------------
// typed endpoints
// --------------------------------------------------------------------------
export interface AlertQuery {
  q?: string;
  src_ip?: string;
  dest_ip?: string;
  signature?: string;
  severity?: string[];
  action?: string[];
  proto?: string;
  source?: string;
  rule_id?: string;
  window?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}

export function buildAlertQuery(query: AlertQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      value.forEach((item) => value && params.append(key, String(item)));
    } else {
      params.append(key, String(value));
    }
  }
  const asString = params.toString();
  return asString ? `?${asString}` : '';
}

export const api = {
  health: (options?: RequestOptions) =>
    request<HealthResponse>(`/api/health${options?.force ? '?force=true' : ''}`, options),
  alerts: (query: AlertQuery, options?: RequestOptions) =>
    request<AlertListResponse>(`/api/alerts${buildAlertQuery(query)}`, options),
  alert: (eventId: string, options?: RequestOptions) =>
    request<EventDetail>(`/api/alerts/${encodeURIComponent(eventId)}`, options),
  stats: (window: string, source: string, options?: RequestOptions) =>
    request<StatsResponse>(`/api/stats?window=${encodeURIComponent(window)}&source=${source}`, options),
  network: (options?: RequestOptions) =>
    request<NetworkStatus>(`/api/network/status${options?.force ? '?force=true' : ''}`, options),
  system: (options?: RequestOptions) => request<SystemStatus>('/api/system/status', options),
  suricata: (options?: RequestOptions) => request<SystemStatus['suricata']>('/api/suricata/status', options),
  responseStatus: (options?: RequestOptions) => request<ResponseStatus>('/api/response/status', options),
  audit: (limit: number, eventId?: string, options?: RequestOptions) =>
    request<AuditEntry[]>(
      `/api/audit?limit=${limit}${eventId ? `&event_id=${encodeURIComponent(eventId)}` : ''}`,
      options,
    ),
  addNote: (
    eventId: string,
    body: { note: string; author: string; status?: string },
    options?: RequestOptions,
  ) =>
    request<{ note: unknown; network_state_changed: boolean; disclosure: string }>(
      `/api/alerts/${encodeURIComponent(eventId)}/notes`,
      { ...options, method: 'POST', body },
    ),
  responseAction: (
    body: {
      event_id: string;
      action_type: string;
      target_ip?: string | null;
      reason: string;
      confirm?: boolean;
      authorization?: string;
    },
    options?: RequestOptions,
  ) => request<ResponseActionResult>('/api/response/actions', { ...options, method: 'POST', body }),
};
