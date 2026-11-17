import type { AppConfig } from '../secrets/config.js';

/**
 * DEMO MODE only: a daily cap on calls to the real AI model.
 *
 * A hosted demo uses the owner's own model key. This cap is the app-side
 * guard against a runaway bill: once the day's calls are used, demo mode
 * answers with the scripted stand-in until midnight UTC. It is a second
 * line of defence, not the only one: the hard limit belongs on the key
 * itself (a spend limit on the provider's side). See
 * docs/runbooks/hosted-demo.md.
 *
 * In-memory on purpose: demo mode is a single process with nothing saved.
 */
export const DEFAULT_DEMO_DAILY_MODEL_CALLS = 200;

export const DEMO_BUDGET_MARKER =
  "(Demo coach: today's AI budget for this demo is used up, so this is a scripted reply. It resets at midnight UTC.)";

let windowKey = '';
let used = 0;

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Take one call from today's budget. False when the budget is spent. */
export function tryConsumeDemoModelCall(config: AppConfig, now: Date = new Date()): boolean {
  const limit = config.demoDailyModelCalls ?? DEFAULT_DEMO_DAILY_MODEL_CALLS;
  const key = dayKey(now);
  if (key !== windowKey) {
    windowKey = key;
    used = 0;
  }
  if (used >= limit) return false;
  used += 1;
  return true;
}

export function demoBudgetUsed(): number {
  return used;
}

/** Test seam. */
export function resetDemoBudgetForTests(): void {
  windowKey = '';
  used = 0;
}
