import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { runCoachingTurn } from '../src/coaching/index.js';
import { getDb } from '../src/shared/db/client.js';
import { encryptPlaintext, hashPhone } from '../src/shared/db/encryption.js';
import { users } from '../src/shared/db/schema/users.js';
import { whatsappMessages } from '../src/shared/db/schema/whatsapp-messages.js';
import { suppressionList } from '../src/shared/db/schema/suppression-list.js';
import { sessions } from '../src/shared/db/schema/sessions.js';
import { turns } from '../src/shared/db/schema/turns.js';
import { memories } from '../src/shared/db/schema/memories.js';
import { buildRateLimiters } from '../src/shared/redis/rate-limit.js';
import { getRedis } from '../src/shared/redis/client.js';
import { loadConfig } from '../src/shared/secrets/config.js';
import { buildTraceEmitter } from '../src/shared/trace/index.js';
import { asPhoneE164, asUserId, type UserId } from '../src/shared/types/index.js';

/**
 * Phase 7 verification harness.
 *
 * Spins up a synthetic onboarded user (no real WhatsApp send unless --send is
 * passed), runs ONE coaching turn end-to-end, and prints:
 *   - terminal end event
 *   - latency (vs 6s p99 budget)
 *   - the actual response text Hogaan would send
 *   - DB side-effects (turn row, memory row, session bumped)
 *
 * Usage:
 *   pnpm exec tsx scripts/verify-phase-7.ts                       # synthetic
 *   pnpm exec tsx scripts/verify-phase-7.ts --send +254768316220  # live dispatch
 *   pnpm exec tsx scripts/verify-phase-7.ts --message "<text>"    # custom prompt
 */

const TEST_PHONE_PREFIX = '+254799700';

const DEFAULT_USER_MESSAGE =
  'My team missed a deadline for the third time this quarter. Two of my reports are blaming each other. What is the question I should walk into the room with?';

async function provisionOnboardedUser(
  db: ReturnType<typeof getDb>['db'],
  config: ReturnType<typeof loadConfig>,
  phoneOverride: string | undefined,
): Promise<{ userId: UserId; phoneE164: string; phoneHash: string }> {
  const phoneE164 = phoneOverride ?? `${TEST_PHONE_PREFIX}001`;
  const phoneHash = hashPhone(phoneE164);
  const phoneEncrypted = encryptPlaintext(config, phoneE164);

  // Idempotent setup: clean prior test state for this phone. Cascade FKs on
  // users handle most child rows when we delete the user row last.
  const prior = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phoneHash, phoneHash))
    .limit(1);
  if (prior[0] !== undefined) {
    await db.delete(memories).where(eq(memories.userId, prior[0].id));
    await db.delete(whatsappMessages).where(eq(whatsappMessages.userId, prior[0].id));
  }
  await db.delete(suppressionList).where(eq(suppressionList.phoneHash, phoneHash));
  await db.delete(users).where(eq(users.phoneHash, phoneHash));

  const ins = await db
    .insert(users)
    .values({
      phoneHash,
      phoneEncrypted,
      status: 'onboarded',
      lastCompletedStep: 7,
      role: 'Professional',
      location: 'Mogadishu',
      isDiaspora: false,
      timezone: 'Africa/Mogadishu',
      goals: ['Conflict resolution', 'Career growth'],
      mappedPractices: ['integrity', 'accountability', 'empathy', 'peace'],
      onboardingCompletedAt: new Date(),
    })
    .returning({ id: users.id });
  const userId = asUserId(ins[0]!.id);

  // Synthesize an inbound row so the 24h customer-service-window check passes.
  await db.insert(whatsappMessages).values({
    correlationId: `verify7-inbound-${Date.now()}`,
    callerProcessId: 'verify-phase-7',
    userId,
    direction: 'inbound',
    messageType: 'free_form',
    contentText: 'hello',
    priority: 'Normal',
    status: 'sent',
    lastStatusAt: new Date(),
  });

  return { userId, phoneE164, phoneHash };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sendIdx = args.indexOf('--send');
  const livePhone = sendIdx >= 0 ? args[sendIdx + 1] : undefined;
  const messageIdx = args.indexOf('--message');
  const message = messageIdx >= 0 ? args[messageIdx + 1] : DEFAULT_USER_MESSAGE;

  const config = loadConfig();
  const { db, close } = getDb(config);
  const redis = getRedis(config);
  const rateLimiters = buildRateLimiters(redis, {
    perSecondLimit: 80,
    perDayLimit: 1000,
    perUserPerHourLimit: 50,
  });
  const traceEmitter = buildTraceEmitter(config);

  console.log('--- setup: synthetic onboarded user ---');
  const u = await provisionOnboardedUser(db, config, livePhone);
  console.log('  userId:', u.userId);
  console.log('  phoneE164:', u.phoneE164);
  console.log('  livePhone:', livePhone !== undefined ? 'YES (real dispatch)' : 'no (synthetic)');

  console.log('\n--- coaching turn ---');
  console.log('  user message:', JSON.stringify(message));

  const t0 = Date.now();
  const r = await runCoachingTurn(
    { config, db, redis, rateLimiters, traceEmitter },
    {
      userId: u.userId,
      phoneE164: asPhoneE164(u.phoneE164),
      phoneHash: u.phoneHash,
      body: message ?? DEFAULT_USER_MESSAGE,
      mediaUrls: [],
      inboundMessageId: `verify7-inbound-${Date.now()}`,
      receivedAt: new Date(),
      traceId: `verify7-${Date.now()}`,
    },
  );
  const elapsedMs = Date.now() - t0;

  console.log('\n--- result ---');
  console.log('  endEvent:', r.endEvent);
  console.log('  practiceTag:', r.practiceTag);
  console.log('  levelTag:', r.levelTag);
  console.log('  end-to-end latency:', elapsedMs, 'ms (target: ≤ 6000ms p99)');
  console.log('  withinBudget:', elapsedMs <= 6000 ? 'YES' : 'NO');
  console.log('  sessionId:', r.sessionId);
  console.log('  turnId:', r.turnId);
  if (r.waMessageId !== undefined) {
    console.log('  Twilio waMessageId:', r.waMessageId);
  }
  if (r.reason !== undefined) {
    console.log('  reason:', r.reason);
  }

  console.log('\n--- response text (Hamse-voice) ---');
  console.log(r.responseText);

  // DB side-effects.
  console.log('\n--- DB side-effects ---');
  const turnRow =
    r.turnId === null ? null : await db.select().from(turns).where(eq(turns.id, r.turnId)).limit(1);
  console.log('  turn row inserted:', turnRow !== null && turnRow[0] !== undefined);
  const memoryRows = await db
    .select({ id: memories.id })
    .from(memories)
    .where(eq(memories.userId, u.userId));
  console.log('  memory rows:', memoryRows.length);
  const sessRow = await db
    .select({ turnCount: sessions.turnCount, lastTurnAt: sessions.lastTurnAt })
    .from(sessions)
    .where(eq(sessions.id, r.sessionId))
    .limit(1);
  console.log('  session.turn_count:', sessRow[0]?.turnCount);

  await close();

  const success =
    r.endEvent === 'E1_TurnCompleted' || r.endEvent === 'E2_TurnCompletedSessionClosed';
  console.log(`\noverall: ${success ? 'PASS' : 'FAIL'} (endEvent=${r.endEvent})`);
  if (!success) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('verify-phase-7 fatal:', err);
  process.exit(1);
});
