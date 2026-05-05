import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { runCoachingTurn } from '../src/coaching/index.js';
import { dispatchDailyPrompts, isOptedIn, setOptIn } from '../src/daily-prompt/index.js';
import { loadScenarioState } from '../src/scenario-learning/index.js';
import { getDb } from '../src/shared/db/client.js';
import { encryptPlaintext, hashPhone } from '../src/shared/db/encryption.js';
import { suppressionList } from '../src/shared/db/schema/suppression-list.js';
import { users } from '../src/shared/db/schema/users.js';
import { whatsappMessages } from '../src/shared/db/schema/whatsapp-messages.js';
import { buildRateLimiters } from '../src/shared/redis/rate-limit.js';
import { getRedis } from '../src/shared/redis/client.js';
import { loadConfig } from '../src/shared/secrets/config.js';
import { buildTraceEmitter } from '../src/shared/trace/index.js';
import { asPhoneE164, asUserId, type UserId } from '../src/shared/types/index.js';

/**
 * Phase 8 verification harness.
 *
 *   pnpm exec tsx scripts/verify-phase-8.ts daily   --send <+E164>
 *   pnpm exec tsx scripts/verify-phase-8.ts scenario --send <+E164>
 *   pnpm exec tsx scripts/verify-phase-8.ts optout  --send <+E164>
 *
 * Each mode (a) provisions / refreshes a synthetic onboarded user keyed on
 * the supplied phone, (b) executes the relevant Phase 8 path, (c) prints
 * results. With --send <+E164>, real Twilio dispatch happens; without --send
 * we still build state but skip outbound.
 */

interface Args {
  mode: 'daily' | 'scenario' | 'optout';
  phone: string | undefined;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const mode = (argv[0] ?? '') as Args['mode'];
  if (mode !== 'daily' && mode !== 'scenario' && mode !== 'optout') {
    throw new Error(`unknown mode: ${argv[0]}. Use one of: daily | scenario | optout`);
  }
  const sendIdx = argv.indexOf('--send');
  const phone = sendIdx >= 0 ? argv[sendIdx + 1] : undefined;
  return { mode, phone };
}

async function provisionUser(
  db: ReturnType<typeof getDb>['db'],
  config: ReturnType<typeof loadConfig>,
  phoneE164: string,
): Promise<{ userId: UserId; phoneHash: string }> {
  const phoneHash = hashPhone(phoneE164);
  const phoneEncrypted = encryptPlaintext(config, phoneE164);

  // Reuse existing user (deletion would trip audit_log append-only trigger).
  // Reset profile_flags + clear whatsapp messages + suppression to give each
  // mode a clean run while preserving audit history.
  const prior = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phoneHash, phoneHash))
    .limit(1);
  let userId: UserId;
  if (prior[0] !== undefined) {
    userId = asUserId(prior[0].id);
    await db.delete(whatsappMessages).where(eq(whatsappMessages.userId, userId as unknown as string));
    await db
      .update(users)
      .set({
        phoneEncrypted,
        status: 'onboarded',
        lastCompletedStep: 7,
        role: 'Professional',
        location: 'Mogadishu',
        isDiaspora: false,
        timezone: 'Africa/Mogadishu',
        goals: ['Leadership confidence'],
        mappedPractices: ['integrity', 'empathy', 'peace'],
        profileFlags: null,
        onboardingCompletedAt: new Date(),
      })
      .where(eq(users.id, userId as unknown as string));
  } else {
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
        goals: ['Leadership confidence'],
        mappedPractices: ['integrity', 'empathy', 'peace'],
        onboardingCompletedAt: new Date(),
      })
      .returning({ id: users.id });
    userId = asUserId(ins[0]!.id);
  }
  await db.delete(suppressionList).where(eq(suppressionList.phoneHash, phoneHash));

  // Inbound row so the 24h window is open for FreeForm sends.
  await db.insert(whatsappMessages).values({
    correlationId: `verify8-inbound-${Date.now()}`,
    callerProcessId: 'verify-phase-8',
    userId,
    direction: 'inbound',
    messageType: 'free_form',
    contentText: 'hello',
    priority: 'Normal',
    status: 'sent',
    lastStatusAt: new Date(),
  });

  return { userId, phoneHash };
}

async function runDaily(
  config: ReturnType<typeof loadConfig>,
  db: ReturnType<typeof getDb>['db'],
  redis: ReturnType<typeof getRedis>,
  rateLimiters: ReturnType<typeof buildRateLimiters>,
  phone: string,
): Promise<boolean> {
  console.log('--- mode: daily prompt ---');
  const u = await provisionUser(db, config, phone);
  console.log('  userId:', u.userId);
  console.log('  phone:', phone);

  console.log('\n--- first run (should dispatch one) ---');
  const r1 = await dispatchDailyPrompts({ config, db, redis, rateLimiters });
  console.log('  result:', JSON.stringify(r1));

  console.log('\n--- second run (idempotent — should skip alreadySentToday) ---');
  const r2 = await dispatchDailyPrompts({ config, db, redis, rateLimiters });
  console.log('  result:', JSON.stringify(r2));

  const ok = r1.dispatched >= 1 && r2.alreadySentToday >= 1;
  console.log(`\noverall: ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

async function runScenario(
  config: ReturnType<typeof loadConfig>,
  db: ReturnType<typeof getDb>['db'],
  redis: ReturnType<typeof getRedis>,
  rateLimiters: ReturnType<typeof buildRateLimiters>,
  traceEmitter: ReturnType<typeof buildTraceEmitter>,
  phone: string,
): Promise<boolean> {
  console.log('--- mode: scenario (3 turns through dignity-the-firing) ---');
  const u = await provisionUser(db, config, phone);
  console.log('  userId:', u.userId);

  // Turn 1: kickoff.
  const t1 = await runCoachingTurn(
    { config, db, redis, rateLimiters, traceEmitter },
    {
      userId: u.userId,
      phoneE164: asPhoneE164(phone),
      phoneHash: u.phoneHash,
      body: "let's practice scenario about firing someone",
      mediaUrls: [],
      inboundMessageId: `verify8-scen-1-${Date.now()}`,
      receivedAt: new Date(),
      traceId: `verify8-scen-1`,
    },
  );
  console.log('  turn1 endEvent:', t1.endEvent, 'reason:', t1.reason);
  console.log('  turn1 response:\n', t1.responseText.slice(0, 400));

  let state = await loadScenarioState(db, u.userId);
  console.log('  state after turn1:', JSON.stringify(state.active));

  if (state.active === null) {
    console.log('FAIL: scenario did not start');
    return false;
  }

  // Turn 2: respond to step 1.
  const t2 = await runCoachingTurn(
    { config, db, redis, rateLimiters, traceEmitter },
    {
      userId: u.userId,
      phoneE164: asPhoneE164(phone),
      phoneHash: u.phoneHash,
      body: "I'd say: I want to talk about your role here. The performance hasn't met what we agreed, and I owe you the honesty. We're going to part ways. I'll do everything I can to make this transition fair.",
      mediaUrls: [],
      inboundMessageId: `verify8-scen-2-${Date.now()}`,
      receivedAt: new Date(),
      traceId: `verify8-scen-2`,
    },
  );
  console.log('\n  turn2 endEvent:', t2.endEvent);
  console.log('  turn2 response:\n', t2.responseText.slice(0, 400));
  state = await loadScenarioState(db, u.userId);
  console.log('  state after turn2:', JSON.stringify(state.active));

  // Turn 3: continue through.
  const t3 = await runCoachingTurn(
    { config, db, redis, rateLimiters, traceEmitter },
    {
      userId: u.userId,
      phoneE164: asPhoneE164(phone),
      phoneHash: u.phoneHash,
      body: "I'd say: this isn't a punishment. It's a recognition that this seat isn't right for you, and staying in it is costing both of us.",
      mediaUrls: [],
      inboundMessageId: `verify8-scen-3-${Date.now()}`,
      receivedAt: new Date(),
      traceId: `verify8-scen-3`,
    },
  );
  console.log('\n  turn3 endEvent:', t3.endEvent);
  console.log('  turn3 response:\n', t3.responseText.slice(0, 400));
  state = await loadScenarioState(db, u.userId);
  console.log(
    '  state after turn3:',
    JSON.stringify({ active: state.active, completed: state.completed }),
  );

  // Turn 4: respond to step 3 (final) — coach should evaluate, write the
  // closing reflection, and mark the scenario complete.
  const t4 = await runCoachingTurn(
    { config, db, redis, rateLimiters, traceEmitter },
    {
      userId: u.userId,
      phoneE164: asPhoneE164(phone),
      phoneHash: u.phoneHash,
      body: "I'd open with: 'I want to be direct with you about something hard. Over the last six months we've fallen short of what we agreed your role would deliver, and I've decided we need to part ways. Their work mattered, and I want them to leave with their dignity intact and a clear path forward.'",
      mediaUrls: [],
      inboundMessageId: `verify8-scen-4-${Date.now()}`,
      receivedAt: new Date(),
      traceId: `verify8-scen-4`,
    },
  );
  console.log('\n  turn4 endEvent:', t4.endEvent);
  console.log('  turn4 response:\n', t4.responseText.slice(0, 600));
  state = await loadScenarioState(db, u.userId);
  console.log(
    '  state after turn4:',
    JSON.stringify({ active: state.active, completed: state.completed }),
  );

  const okStarted = t1.endEvent === 'E4_ScenarioHandoff';
  const okCompleted = state.active === null && state.completed.includes('dignity-the-firing');
  const ok = okStarted && okCompleted;
  console.log(`\noverall: ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

async function runOptOut(
  config: ReturnType<typeof loadConfig>,
  db: ReturnType<typeof getDb>['db'],
  redis: ReturnType<typeof getRedis>,
  rateLimiters: ReturnType<typeof buildRateLimiters>,
  phone: string,
): Promise<boolean> {
  console.log('--- mode: opt-out for daily prompts ---');
  const u = await provisionUser(db, config, phone);
  console.log('  userId:', u.userId);

  // Confirm default is opted in.
  let row = await db
    .select({ profileFlags: users.profileFlags })
    .from(users)
    .where(eq(users.id, u.userId as unknown as string))
    .limit(1);
  console.log('  default opted-in:', isOptedIn(row[0]?.profileFlags ?? null));

  // Flip to opted-out.
  await setOptIn(db, u.userId, false);
  row = await db
    .select({ profileFlags: users.profileFlags })
    .from(users)
    .where(eq(users.id, u.userId as unknown as string))
    .limit(1);
  console.log('  after setOptIn(false):', isOptedIn(row[0]?.profileFlags ?? null));

  const r = await dispatchDailyPrompts({ config, db, redis, rateLimiters });
  console.log('  dispatch result:', JSON.stringify(r));

  const ok = isOptedIn(row[0]?.profileFlags ?? null) === false && r.skippedOptedOut >= 1;
  console.log(`\noverall: ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.phone === undefined) {
    throw new Error('Phase 8 verify requires --send <+E164> for live dispatch');
  }

  const config = loadConfig();
  const { db, close } = getDb(config);
  const redis = getRedis(config);
  const rateLimiters = buildRateLimiters(redis, {
    perSecondLimit: 80,
    perDayLimit: 1000,
    perUserPerHourLimit: 50,
  });
  const traceEmitter = buildTraceEmitter(config);

  let pass = false;
  try {
    if (args.mode === 'daily') {
      pass = await runDaily(config, db, redis, rateLimiters, args.phone);
    } else if (args.mode === 'scenario') {
      pass = await runScenario(config, db, redis, rateLimiters, traceEmitter, args.phone);
    } else {
      pass = await runOptOut(config, db, redis, rateLimiters, args.phone);
    }
  } finally {
    await close();
  }

  if (!pass) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('verify-phase-8 fatal:', err);
  process.exit(1);
});
