import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { type CrisisResourcesPayload, getActiveLibraryVersions } from '../libraries/index.js';
import type { Database } from '../shared/db/client.js';
import { crisisEvents } from '../shared/db/schema/crisis-events.js';
import { libraryVersions as libraryVersionsTable } from '../shared/db/schema/library-versions.js';
import { reportIncident } from '../shared/observability/incidents.js';
import type { RedisBundle } from '../shared/redis/client.js';
import type { RateLimiters } from '../shared/redis/rate-limit.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { asCorrelationId } from '../shared/types/index.js';
import { sendOutbound } from '../whatsapp-delivery/orchestrator.js';
import type { CrisisHandoffInput, CrisisHandoffResult } from './types.js';

interface HandoffDeps {
  config: AppConfig;
  db: Database;
  redis: RedisBundle;
  rateLimiters: RateLimiters;
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
  // Step 1: resolve crisis_resources.
  const libs = await getActiveLibraryVersions(deps.db);
  const resourcesPayload: CrisisResourcesPayload = libs.crisisResources.payload;
  const resourcesVersion = libs.crisisResources.version;

  // Step 2: render message body. Holding message + resource list, plain text
  // for WhatsApp.
  const body = renderCrisisMessage(resourcesPayload);

  // Step 3: dispatch via Process #11 with priority=Critical.
  let outcomeCategory: CrisisHandoffResult['outcomeCategory'];
  let waMessageId: string | undefined;
  let errorReason: string | undefined;

  const correlationId = asCorrelationId(`crisis-${randomUUID()}`);

  const send = await sendOutbound(
    {
      config: deps.config,
      db: deps.db,
      redis: deps.redis,
      rateLimiters: deps.rateLimiters,
      ownerId: 'crisis-handoff',
    },
    {
      correlationId,
      callerProcessId: `crisis-handoff:${input.triggerSource}`,
      phoneE164: input.phoneE164,
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
      messageType: 'FreeForm',
      priority: 'Critical',
      body,
    },
  );

  if (
    send.endEvent === 'E1_MessageDispatched' ||
    send.endEvent === 'E2_MessageDispatchedAfterRetry'
  ) {
    outcomeCategory = 'handoff_dispatched';
    waMessageId = send.waMessageId;
  } else if (send.endEvent === 'E5_DuplicateRequest') {
    outcomeCategory = 'duplicate_suppressed';
    errorReason = send.reason ?? 'duplicate';
  } else if (send.endEvent === 'E7_SuppressedRecipient') {
    // The user opted out. Per Process #11 §3 we MUST honor that even for
    // crisis. Record the fact so ops can intervene out-of-band.
    outcomeCategory = 'handoff_blocked_by_suppression';
    errorReason = send.reason ?? 'recipient suppressed';
  } else {
    outcomeCategory = 'handoff_failed';
    errorReason = `${send.endEvent}: ${send.reason ?? 'unknown'}`;
  }

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

function renderCrisisMessage(p: CrisisResourcesPayload): string {
  const lines: string[] = [p.holdingMessage, ''];
  for (const r of p.resources) {
    lines.push(`*${r.name}* (${r.region})`);
    for (const c of r.channels) {
      const note = c.note !== undefined ? ` — ${c.note}` : '';
      lines.push(`  ${c.kind}: ${c.value}${note}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
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
