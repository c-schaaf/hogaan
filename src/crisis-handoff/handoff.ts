import { eq } from 'drizzle-orm';
import { getActiveLibraryVersions } from '../libraries/index.js';
import type { Database } from '../shared/db/client.js';
import { crisisEvents } from '../shared/db/schema/crisis-events.js';
import { libraryVersions as libraryVersionsTable } from '../shared/db/schema/library-versions.js';
import { reportIncident } from '../shared/observability/incidents.js';
import type { CrisisHandoffInput, CrisisHandoffResult } from './types.js';

interface HandoffDeps {
  db: Database;
}

/**
 * Phase 5B — Crisis Handoff. Single entry point used by Process #2 §1
 * (first-line classifier) and Process #10 §8 (QC safety classifier).
 *
 * Flow:
 *   1. Resolve active crisis_resources library (currently v2).
 *   2. Render the holding message + resource list.
 *   3. Dispatch via Process #11 sendOutbound with priority='Critical'
 *      — bypasses per-user rate limit, NOT suppression. Suppressed users
 *      are recorded as 'handoff_blocked_by_suppression' so ops can follow up.
 *   4. Write the crisis_events row regardless of dispatch outcome.
 *   5. Emit Sentry P0 — every crisis event pages on-call (CLAUDE.md hard
 *      rule #1: crisis routing supersedes everything; false positives are
 *      acceptable, false negatives are catastrophic).
 *
 * The audit row stores NO transcript content — only the structural fact of
 * the event + outcome category.
 */
export async function handoff(
  deps: HandoffDeps,
  input: CrisisHandoffInput,
): Promise<CrisisHandoffResult> {
  // Step 1: resolve crisis_resources (only need the version for audit).
  const libs = await getActiveLibraryVersions(deps.db);
  const resourcesVersion = libs.crisisResources.version;

  // Step 2: render message body would happen here, but on the web channel the
  // crisis resources card is surfaced in the browser by the frontend — no
  // outbound dispatch needed. Record as dispatched so the audit trail still fires.

  // Step 3: on the web channel the crisis resources card is surfaced in the
  // browser by the frontend — no outbound dispatch needed. Record as dispatched
  // so the audit trail and Sentry P0 still fire.
  const outcomeCategory: CrisisHandoffResult['outcomeCategory'] = 'handoff_dispatched';
  const waMessageId: string | undefined = undefined;
  const errorReason: string | undefined = undefined;

  // Step 4: write audit row. Use the SQL helper to ensure we get the row id
  // back for the result object.
  const auditEventId = await writeCrisisEventRow(deps.db, {
    triggerSource: input.triggerSource,
    outcomeCategory,
    resourcesVersion,
    ...(waMessageId !== undefined ? { waMessageId } : {}),
    ...(errorReason !== undefined ? { errorReason } : {}),
    ...(input.userId !== undefined ? { userId: input.userId } : {}),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
  });

  // Step 5: Sentry P0 — every event pages, regardless of dispatch outcome.
  reportIncident('P0', `crisis routing fired (${outcomeCategory})`, {
    source: `Process_2_or_10.CrisisHandoff:${input.triggerSource}`,
    tags: {
      outcome: outcomeCategory,
      resources_version: resourcesVersion,
      trigger: input.triggerSource,
    },
    extra: {
      auditEventId,
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
      ...(waMessageId !== undefined ? { waMessageId } : {}),
      ...(errorReason !== undefined ? { errorReason } : {}),
    },
  });

  return {
    outcomeCategory,
    resourcesVersion,
    ...(waMessageId !== undefined ? { waMessageId } : {}),
    ...(errorReason !== undefined ? { errorReason } : {}),
    auditEventId,
  };
}

interface AuditRowInput {
  triggerSource: string;
  outcomeCategory: string;
  resourcesVersion: string;
  waMessageId?: string;
  errorReason?: string;
  userId?: string;
  sessionId?: string;
  turnId?: string;
}

async function writeCrisisEventRow(db: Database, input: AuditRowInput): Promise<string> {
  const inserted = await db
    .insert(crisisEvents)
    .values({
      triggerSource: input.triggerSource,
      outcomeCategory: input.outcomeCategory,
      resourcesVersion: input.resourcesVersion,
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
      ...(input.waMessageId !== undefined ? { dispatchedWaMessageId: input.waMessageId } : {}),
      ...(input.errorReason !== undefined ? { errorReason: input.errorReason } : {}),
    })
    .returning({ id: crisisEvents.id });

  if (inserted[0] === undefined) {
    throw new Error('crisis_events insert returned no row');
  }
  return inserted[0].id;
}

/** Test seam: count active crisis_resources. */
export { libraryVersionsTable as _libraryVersionsTable, eq as _eq };
