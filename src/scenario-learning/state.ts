import { eq } from 'drizzle-orm';
import type { Database } from '../shared/db/client.js';
import { users } from '../shared/db/schema/users.js';
import type { UserId } from '../shared/types/index.js';

/**
 * Scenario state lives on `users.profile_flags`. We avoid a new table for
 * Phase A — there's exactly one active scenario per user at a time, and
 * the completion list is a small string array. Schema changes have a
 * migration cost we don't need to pay yet.
 *
 * Shape:
 *   profile_flags.activeScenario: { scenarioId, currentStep, startedAt }
 *   profile_flags.completedScenarios: string[]    // scenario ids
 */

const ACTIVE_KEY = 'activeScenario';
const COMPLETED_KEY = 'completedScenarios';

export interface ActiveScenarioState {
  scenarioId: string;
  /** 1-indexed; matches ScenarioStep.step. */
  currentStep: number;
  /** ISO-8601. */
  startedAt: string;
}

export interface ScenarioStateView {
  active: ActiveScenarioState | null;
  completed: string[];
}

function readFlags(profileFlags: unknown): Record<string, unknown> {
  if (profileFlags === null || profileFlags === undefined || typeof profileFlags !== 'object') {
    return {};
  }
  return profileFlags as Record<string, unknown>;
}

export function parseScenarioState(profileFlags: unknown): ScenarioStateView {
  const flags = readFlags(profileFlags);
  const rawActive = flags[ACTIVE_KEY];
  let active: ActiveScenarioState | null = null;
  if (
    rawActive !== null &&
    rawActive !== undefined &&
    typeof rawActive === 'object' &&
    typeof (rawActive as { scenarioId?: unknown }).scenarioId === 'string' &&
    typeof (rawActive as { currentStep?: unknown }).currentStep === 'number' &&
    typeof (rawActive as { startedAt?: unknown }).startedAt === 'string'
  ) {
    const v = rawActive as ActiveScenarioState;
    active = { scenarioId: v.scenarioId, currentStep: v.currentStep, startedAt: v.startedAt };
  }
  const rawCompleted = flags[COMPLETED_KEY];
  const completed = Array.isArray(rawCompleted)
    ? rawCompleted.filter((x): x is string => typeof x === 'string')
    : [];
  return { active, completed };
}

export async function loadScenarioState(db: Database, userId: UserId): Promise<ScenarioStateView> {
  const rows = await db
    .select({ profileFlags: users.profileFlags })
    .from(users)
    .where(eq(users.id, userId as unknown as string))
    .limit(1);
  return parseScenarioState(rows[0]?.profileFlags ?? null);
}

export async function startScenario(
  db: Database,
  userId: UserId,
  scenarioId: string,
  now: Date = new Date(),
): Promise<ActiveScenarioState> {
  const active: ActiveScenarioState = {
    scenarioId,
    currentStep: 1,
    startedAt: now.toISOString(),
  };
  await mergeFlags(db, userId, { [ACTIVE_KEY]: active });
  return active;
}

export async function advanceStep(db: Database, userId: UserId, toStep: number): Promise<void> {
  const state = await loadScenarioState(db, userId);
  if (state.active === null) {
    throw new Error(`advanceStep: no active scenario for user ${userId}`);
  }
  const next: ActiveScenarioState = { ...state.active, currentStep: toStep };
  await mergeFlags(db, userId, { [ACTIVE_KEY]: next });
}

export async function completeScenario(
  db: Database,
  userId: UserId,
  scenarioId: string,
): Promise<void> {
  const state = await loadScenarioState(db, userId);
  const updatedCompleted = state.completed.includes(scenarioId)
    ? state.completed
    : [...state.completed, scenarioId];
  await mergeFlags(db, userId, {
    [ACTIVE_KEY]: null,
    [COMPLETED_KEY]: updatedCompleted,
  });
}

/** Abandon the active scenario without crediting completion. */
export async function abandonScenario(db: Database, userId: UserId): Promise<void> {
  await mergeFlags(db, userId, { [ACTIVE_KEY]: null });
}

async function mergeFlags(
  db: Database,
  userId: UserId,
  patch: Record<string, unknown>,
): Promise<void> {
  const rows = await db
    .select({ profileFlags: users.profileFlags })
    .from(users)
    .where(eq(users.id, userId as unknown as string))
    .limit(1);
  const existing = readFlags(rows[0]?.profileFlags ?? null);
  const next: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) {
      delete next[k];
    } else {
      next[k] = v;
    }
  }
  await db
    .update(users)
    .set({ profileFlags: next })
    .where(eq(users.id, userId as unknown as string));
}
