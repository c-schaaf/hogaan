import { eq } from 'drizzle-orm';
import { retrieveMemories } from '../memory/index.js';
import { reportP2 } from '../incident-handling/index.js';
import { fetchRecentTurns } from '../session-lifecycle/index.js';
import type { Database } from '../shared/db/client.js';
import { users } from '../shared/db/schema/users.js';
import { decryptPlaintext } from '../shared/db/encryption.js';
import { getBrief } from '../leader-context/store.js';
import { renderBriefBlock } from '../leader-context/render.js';
import { surnamesFromFullName } from '../shared/pii/filter.js';
import type { AppConfig } from '../shared/secrets/config.js';
import type { PracticeTag, SessionId, UserId } from '../shared/types/index.js';
import type { CoachingContext } from './types.js';

/**
 * Process #2 Step 5 — parallel context fetch with bounded join.
 *
 * Three independent fetches:
 *   (a) Memory: Voyage embedding + pgvector cosine top-N (Phase 4A).
 *   (b) Profile: SELECT users by id.
 *   (c) Recent session turns: last 3-5 turns of the current session (Phase 4B).
 *
 * Per Process #2 §5 plan note (and Phase 4 plan §7.5 open question), the
 * BPMN labels this "blocking" but the practical interpretation is
 * "soft-blocking": each branch independently falls back to empty on failure
 * and we proceed with whatever we got. The tradeoff: a degraded turn beats
 * a missed turn.
 *
 * `partialFailure=true` propagates to the trace + degradation flags so we
 * can audit how often the fallback fires.
 */

const FETCH_TIMEOUT_MS = 1500;

interface FetchDeps {
  config: AppConfig;
  db: Database;
}

export interface ContextFetchOptions {
  userId: UserId;
  sessionId: SessionId;
  /** The user's current message — drives the memory similarity query. */
  query: string;
  memoryTopN?: number;
  recentTurnsLimit?: number;
  /** P1.1 — read the leader brief (flag-gated by the caller). */
  includeBrief?: boolean;
}

export async function fetchCoachingContext(
  deps: FetchDeps,
  opts: ContextFetchOptions,
): Promise<CoachingContext> {
  const memN = opts.memoryTopN ?? 5;
  const turnLim = opts.recentTurnsLimit ?? 5;

  const [memResult, profResult, turnResult, briefResult] = await Promise.allSettled([
    withTimeout(
      memN > 0
        ? retrieveMemories(deps.config, deps.db, opts.userId, opts.query, memN)
        : Promise.resolve([]),
      FETCH_TIMEOUT_MS,
      'memory',
    ),
    withTimeout(fetchProfile(deps.config, deps.db, opts.userId), FETCH_TIMEOUT_MS, 'profile'),
    withTimeout(
      fetchRecentTurns(deps.db, opts.sessionId, turnLim),
      FETCH_TIMEOUT_MS,
      'session-turns',
    ),
    withTimeout(
      opts.includeBrief === true
        ? getBrief(deps.config, deps.db, opts.userId).then(renderBriefBlock)
        : Promise.resolve(''),
      FETCH_TIMEOUT_MS,
      'leader-brief',
    ),
  ]);

  const memories =
    memResult.status === 'fulfilled'
      ? memResult.value.map((m) => ({ content: m.content, createdAt: m.createdAt }))
      : [];
  const profile = profResult.status === 'fulfilled' ? profResult.value.profile : {};
  const knownSurnames = profResult.status === 'fulfilled' ? profResult.value.surnames : [];
  const leaderContextText = briefResult.status === 'fulfilled' ? briefResult.value : '';
  const sessionTurns =
    turnResult.status === 'fulfilled'
      ? turnResult.value.map((t) => ({ userMessage: t.userMessage, responseText: t.responseText }))
      : [];

  const failures: string[] = [];
  if (memResult.status === 'rejected') {
    failures.push(`memory: ${(memResult.reason as Error)?.message ?? 'unknown'}`);
  }
  if (profResult.status === 'rejected') {
    failures.push(`profile: ${(profResult.reason as Error)?.message ?? 'unknown'}`);
  }
  if (briefResult.status === 'rejected') {
    failures.push(`leader-brief: ${(briefResult.reason as Error)?.message ?? 'unknown'}`);
  }
  if (turnResult.status === 'rejected') {
    failures.push(`session-turns: ${(turnResult.reason as Error)?.message ?? 'unknown'}`);
  }

  if (failures.length > 0) {
    reportP2('coaching context fetch had partial failures', {
      source: 'Process_2.Step_5.ContextFetch',
      extra: { userId: opts.userId, sessionId: opts.sessionId, failures },
    });
  }

  return {
    memories,
    profile,
    sessionTurns,
    leaderContextText,
    knownSurnames,
    partialFailure: failures.length > 0,
  };
}

async function fetchProfile(
  config: AppConfig,
  db: Database,
  userId: UserId,
): Promise<{ profile: CoachingContext['profile']; surnames: string[] }> {
  const rows = await db
    .select({
      fullNameEncrypted: users.fullNameEncrypted,
      role: users.role,
      experienceBand: users.experienceBand,
      location: users.location,
      timezone: users.timezone,
      mappedPractices: users.mappedPractices,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    return { profile: {}, surnames: [] };
  }
  let surnames: string[] = [];
  if (typeof row.fullNameEncrypted === 'string' && row.fullNameEncrypted.length > 0) {
    try {
      surnames = surnamesFromFullName(decryptPlaintext(config, row.fullNameEncrypted));
    } catch {
      surnames = [];
    }
  }
  const profile: CoachingContext['profile'] = {
    ...(typeof row.role === 'string' ? { role: row.role } : {}),
    ...(typeof row.experienceBand === 'string' ? { experienceBand: row.experienceBand } : {}),
    ...(typeof row.location === 'string' ? { location: row.location } : {}),
    ...(typeof row.timezone === 'string' ? { timezone: row.timezone } : {}),
    ...(Array.isArray(row.mappedPractices)
      ? { mappedPractices: row.mappedPractices as PracticeTag[] }
      : {}),
  };
  return { profile, surnames };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`context fetch timeout: ${label} (${ms}ms)`)),
        ms,
      );
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    }),
  ]);
}
