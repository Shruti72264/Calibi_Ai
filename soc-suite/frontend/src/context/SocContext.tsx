/**
 * Application-wide SOC state.
 *
 * One place owns the polling cadence, the health/system snapshots and the time
 * window, so every page shows *the same* freshness and the same window. When the
 * backend is unreachable the context keeps the last good payload and exposes the
 * error, letting the UI say "showing the last successful read" instead of
 * blanking out.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import type { HealthResponse, SystemStatus } from '../api/types';
import { useApi, type AsyncState } from '../hooks/useApi';

export const REFRESH_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '5s', value: 5000 },
  { label: '15s', value: 15000 },
  { label: '30s', value: 30000 },
  { label: '1m', value: 60000 },
] as const;

export const WINDOW_OPTIONS = [
  { label: 'All evidence', value: 'all' },
  { label: 'Last 24 hours', value: '24h' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
] as const;

interface SocState {
  health: AsyncState<HealthResponse>;
  system: AsyncState<SystemStatus>;
  intervalMs: number;
  setIntervalMs: (value: number) => void;
  window: string;
  setWindow: (value: string) => void;
  connectionError: ApiError | null;
  backendReachable: boolean;
}

const SocContext = createContext<SocState | null>(null);

export function SocProvider({ children }: { children: ReactNode }) {
  const [intervalMs, setIntervalMs] = useState<number>(15000);
  const [window, setWindow] = useState<string>('all');

  const health = useApi<HealthResponse>(
    ({ signal, force }) => api.health({ signal, force }),
    [],
    { intervalMs },
  );
  const system = useApi<SystemStatus>(({ signal }) => api.system({ signal }), [], {
    intervalMs: intervalMs === 0 ? 0 : Math.max(intervalMs, 30000),
  });

  const value = useMemo<SocState>(() => {
    const connectionError = health.error ?? system.error ?? null;
    return {
      health,
      system,
      intervalMs,
      setIntervalMs,
      window,
      setWindow,
      connectionError,
      backendReachable: !(connectionError && connectionError.isNetworkError),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health.data, health.error, health.lastUpdated, health.loading, system.data, system.error, intervalMs, window]);

  return <SocContext.Provider value={value}>{children}</SocContext.Provider>;
}

export function useSoc(): SocState {
  const context = useContext(SocContext);
  if (!context) throw new Error('useSoc must be used inside <SocProvider>');
  return context;
}
