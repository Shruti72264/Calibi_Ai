/**
 * Data-fetching hooks.
 *
 * Polling (not websockets) is the deliberate choice for v1: a SOC dashboard
 * reads a handful of endpoints and the operator must always be able to see
 * *when* the data was last refreshed. Every hook therefore exposes:
 *   { data, error, loading, lastUpdated, refresh }
 * so no component ever has to guess at freshness.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';

export interface AsyncState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  lastUpdated: Date | null;
  refreshing: boolean;
  refresh: () => void;
}

export interface PollOptions {
  /** Poll interval in ms; 0 or undefined disables polling. */
  intervalMs?: number;
  enabled?: boolean;
  /** Bypass the server-side cache on the next (and every) fetch. */
  force?: boolean;
}

export function useApi<T>(
  fetcher: (options: { signal: AbortSignal; force?: boolean }) => Promise<T>,
  deps: unknown[] = [],
  options: PollOptions = {},
): AsyncState<T> {
  const { intervalMs = 0, enabled = true, force = false } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [nonce, setNonce] = useState(0);

  // Keep the latest fetcher without re-triggering the effect on every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const firstLoad = useRef(true);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;

    const run = async () => {
      if (firstLoad.current) setLoading(true);
      else setRefreshing(true);
      try {
        const result = await fetcherRef.current({ signal: controller.signal, force });
        if (cancelled) return;
        setData(result);
        setError(null);
        setLastUpdated(new Date());
      } catch (caught) {
        if (cancelled || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError(String(caught), 0, '', true),
        );
      } finally {
        if (!cancelled) {
          firstLoad.current = false;
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void run();

    let timer: number | undefined;
    if (intervalMs > 0) {
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void run();
      }, intervalMs);
    }

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intervalMs, enabled, force, nonce]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  return { data, error, loading, lastUpdated, refreshing, refresh };
}

/** A ticking clock so "updated 12s ago" stays truthful without a re-fetch. */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
