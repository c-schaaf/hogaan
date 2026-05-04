import type { AppConfig } from '../secrets/config.js';

/**
 * BetterStack heartbeat: POST to a configured URL on a fixed interval. If the
 * URL doesn't receive a beat within its grace window, BetterStack pages the
 * on-call. Per Render's instance lifecycle, every active web instance ticks
 * independently; if one dies its heartbeats stop.
 *
 * No-op when BETTERSTACK_HEARTBEAT_URL is unset. Stop function is idempotent.
 */
export function startHeartbeat(config: AppConfig, intervalMs: number = 30_000): { stop(): void } {
  const url = config.betterstackHeartbeatUrl;
  if (url === undefined) {
    return { stop: () => undefined };
  }

  const tick = async (): Promise<void> => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5_000);
      try {
        await fetch(url, { method: 'GET', signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Heartbeat failures are detectable from BetterStack's side (missed
      // beats); we don't escalate them locally — that would be a feedback loop.
    }
  };

  void tick();
  const interval = setInterval(() => void tick(), intervalMs);
  if (typeof interval.unref === 'function') {
    interval.unref();
  }

  let stopped = false;
  return {
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      clearInterval(interval);
    },
  };
}
