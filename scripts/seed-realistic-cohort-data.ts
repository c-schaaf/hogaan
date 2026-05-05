import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../src/shared/db/client.js';
import { encryptPlaintext, hashPhone } from '../src/shared/db/encryption.js';
import { accessCodes } from '../src/shared/db/schema/access-codes.js';
import { cohorts } from '../src/shared/db/schema/cohorts.js';
import { crisisEvents } from '../src/shared/db/schema/crisis-events.js';
import { sessions } from '../src/shared/db/schema/sessions.js';
import { sponsors } from '../src/shared/db/schema/sponsors.js';
import { turns } from '../src/shared/db/schema/turns.js';
import { users } from '../src/shared/db/schema/users.js';
import { loadConfig } from '../src/shared/secrets/config.js';

/**
 * Phase 9A — realistic synthetic cohort data for Hamse-facing portal demo.
 *
 * Attaches ~60 synthetic users + activity + 2-3 crisis events to the
 * existing "Test Cohort" under "Test Sponsor". All synthetic users live
 * in the dedicated phone range +254700000001..+254700000060 — that range
 * is the marker the teardown script uses to find and remove them.
 *
 * **Bulk insert strategy**: a previous serial-insert version took 15+ min
 * over the cross-region pooler. This rewrite buffers all rows in memory
 * then issues one chunked INSERT per table — completes in seconds.
 *
 * Idempotent: if a user (by phoneHash) already exists with any turns
 * already attached, we skip them entirely. Net-new users get the full
 * activity payload. Crisis events are tagged with a deterministic
 * marker in `errorReason` for skip-on-rerun detection.
 *
 * Determinism: a per-script mulberry32 RNG seeded with a fixed string
 * gives stable distributions across runs.
 *
 * Reverse with: scripts/teardown-realistic-cohort-data.ts
 */

const SPONSOR_LEGAL_NAME = 'Test Sponsor';
const COHORT_NAME = 'Test Cohort';
const PHONE_PREFIX = '+25470000';
const USER_COUNT = 60;
const PHONE_FIRST_INDEX = 1;
const SEED_TAG = 'realistic-cohort-seed-v1';

// Postgres bind-parameter cap is 65535. Sessions have ~6 columns; turns
// have ~14. Chunk sizes leave generous headroom.
const SESSIONS_CHUNK = 1000;
const TURNS_CHUNK = 500;

// ------------------------------------------------------------------------
// Distribution constants
// ------------------------------------------------------------------------

const FIRST_NAMES = [
  'Khadija',
  'Aden',
  'Hodan',
  'Ahmed',
  'Ifrah',
  'Amina',
  'Yusuf',
  'Fatima',
  'Mohamed',
  'Ayaan',
  'Sadia',
  'Abdi',
  'Halima',
  'Ismail',
  'Layla',
  'Hassan',
  'Zeinab',
  'Omar',
  'Nasra',
  'Hamza',
  'Farah',
  'Ridwan',
  'Asha',
  'Bashir',
  'Sahra',
  'Nuur',
  'Maryam',
  'Khalid',
  'Sarah',
  'James',
  'Priya',
  'David',
  'Daniel',
  'Maria',
  'Aisha',
  'Tariq',
];

const ROLES = ['Student', 'Professional', 'Leader'] as const;
const ROLE_WEIGHTS = [0.3, 0.5, 0.2];

const LOCATIONS: { name: string; weight: number; isDiaspora: boolean }[] = [
  { name: 'Mogadishu', weight: 0.7, isDiaspora: false },
  { name: 'Hargeisa', weight: 0.25, isDiaspora: false },
  { name: 'Minneapolis', weight: 0.03, isDiaspora: true },
  { name: 'Nairobi', weight: 0.02, isDiaspora: true },
];

const GOAL_OPTIONS = [
  'Leadership confidence',
  'Conflict resolution',
  'Career growth',
  'Communication skills',
];

const PRACTICES = [
  'integrity',
  'purpose',
  'accountability',
  'dignity',
  'empathy',
  'inclusion',
  'assets',
  'innovation',
  'prosperity',
  'humility',
  'democracy',
  'peace',
] as const;

const PRACTICE_WEIGHTS: Record<string, number> = {
  empathy: 12,
  integrity: 12,
  accountability: 11,
  dignity: 10,
  purpose: 9,
  inclusion: 9,
  humility: 8,
  peace: 8,
  assets: 6,
  innovation: 5,
  prosperity: 5,
  democracy: 5,
};

const APPROVED_OUTCOMES = ['E1_ApprovedFirstAttempt', 'E2_ApprovedRegenerated'] as const;
const NON_APPROVED_OUTCOMES = ['E3_MaxRetriesExceeded', 'E6_ServiceUnavailable'] as const;

const CRISIS_PLAN = [
  { userIdx: 7, triggerSource: 'process_2_step_1', outcomeCategory: 'handoff_dispatched' },
  { userIdx: 23, triggerSource: 'process_10_check_8', outcomeCategory: 'handoff_dispatched' },
  { userIdx: 41, triggerSource: 'process_2_step_1', outcomeCategory: 'duplicate_suppressed' },
] as const;

// ------------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------------

function makeRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T>(rng: () => number, items: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  const r = rng() * total;
  let acc = 0;
  for (let i = 0; i < items.length; i++) {
    acc += weights[i]!;
    if (r < acc) {
      return items[i]!;
    }
  }
  return items[items.length - 1]!;
}

function pickPractice(rng: () => number): string {
  const weights = PRACTICES.map((p) => PRACTICE_WEIGHTS[p] ?? 1);
  return pickWeighted(rng, PRACTICES, weights);
}

function phoneFor(index: number): string {
  return `${PHONE_PREFIX}${String(index).padStart(4, '0')}`;
}

async function chunkInsert<R>(
  rows: R[],
  chunkSize: number,
  exec: (chunk: R[]) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await exec(rows.slice(i, i + chunkSize));
  }
}

// ------------------------------------------------------------------------
// Types for the in-memory plan
// ------------------------------------------------------------------------

interface UserPlan {
  phoneIdx: number;
  phone: string;
  phoneHash: string;
  insertRow: typeof users.$inferInsert | null;
  /** Resolved DB id once the user row exists. */
  userId: string | null;
  /** Activity should be seeded for this user. False when the user pre-existed and already had turns. */
  needsActivity: boolean;
  onboardingCompletedAt: Date;
}

interface PendingSession {
  userPhoneIdx: number;
  userId: string;
  startedAt: Date;
  /** Computed up front so we can populate sessions.last_turn_at on insert. */
  lastTurnAt: Date;
  turnCount: number;
  /** Synthesized turns for this session. session_id will be backfilled after insert. */
  pendingTurns: PendingTurn[];
}

interface PendingTurn {
  userId: string;
  practice: string;
  levelTag: string;
  qaOutcome: string;
  retryCount: number;
  isNonApproved: boolean;
  latencyMs: number;
  createdAt: Date;
}

interface SeedSummary {
  usersCreated: number;
  usersExisting: number;
  sessionsCreated: number;
  turnsCreated: number;
  practiceDistribution: Record<string, number>;
  qaOutcomeDistribution: Record<string, number>;
  locationDistribution: Record<string, number>;
  roleDistribution: Record<string, number>;
  diasporaCount: number;
  crisisEventsCreated: number;
  crisisEventsExisting: number;
}

// ------------------------------------------------------------------------
// Main
// ------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, close } = getDb(config);
  const summary: SeedSummary = {
    usersCreated: 0,
    usersExisting: 0,
    sessionsCreated: 0,
    turnsCreated: 0,
    practiceDistribution: {},
    qaOutcomeDistribution: {},
    locationDistribution: {},
    roleDistribution: {},
    diasporaCount: 0,
    crisisEventsCreated: 0,
    crisisEventsExisting: 0,
  };

  try {
    console.log('looking up existing test sponsor + cohort...');
    const sp = await db
      .select({ id: sponsors.id })
      .from(sponsors)
      .where(eq(sponsors.legalName, SPONSOR_LEGAL_NAME))
      .limit(1);
    if (sp[0] === undefined) {
      throw new Error(`Test Sponsor not found. Run scripts/seed-test-sponsor.ts first.`);
    }
    const co = await db
      .select({ id: cohorts.id })
      .from(cohorts)
      .where(eq(cohorts.name, COHORT_NAME))
      .limit(1);
    if (co[0] === undefined) {
      throw new Error(`Test Cohort not found. Run scripts/seed-test-sponsor.ts.`);
    }
    const cohortId = co[0].id;
    console.log(`  cohort=${cohortId}`);

    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    // -----------------------------------------------------------------
    // Phase 1: build user plans (in memory)
    // -----------------------------------------------------------------
    const plans: UserPlan[] = [];
    for (let i = 0; i < USER_COUNT; i++) {
      const phoneIdx = PHONE_FIRST_INDEX + i;
      const phone = phoneFor(phoneIdx);
      const phoneHash = hashPhone(phone);
      const userRng = makeRng(`${SEED_TAG}|user|${phoneIdx}`);

      const firstName = FIRST_NAMES[Math.floor(userRng() * FIRST_NAMES.length)]!;
      const role = pickWeighted(userRng, ROLES, ROLE_WEIGHTS);
      const loc = pickWeighted(
        userRng,
        LOCATIONS,
        LOCATIONS.map((l) => l.weight),
      );
      const goalCount = 1 + Math.floor(userRng() * 3);
      const shuffledGoals = [...GOAL_OPTIONS].sort(() => userRng() - 0.5);
      const goals = shuffledGoals.slice(0, goalCount);
      const mappedPractices = [pickPractice(userRng), pickPractice(userRng)];

      const onboardOffsetMs = userRng() * (now.getTime() - ninetyDaysAgo.getTime());
      const onboardingCompletedAt = new Date(ninetyDaysAgo.getTime() + onboardOffsetMs);

      summary.locationDistribution[loc.name] = (summary.locationDistribution[loc.name] ?? 0) + 1;
      summary.roleDistribution[role] = (summary.roleDistribution[role] ?? 0) + 1;
      if (loc.isDiaspora) {
        summary.diasporaCount += 1;
      }

      plans.push({
        phoneIdx,
        phone,
        phoneHash,
        insertRow: {
          phoneHash,
          phoneEncrypted: encryptPlaintext(config, phone),
          firstNameEncrypted: encryptPlaintext(config, firstName),
          status: 'onboarded',
          lastCompletedStep: 7,
          needsProfileReview: false,
          goals,
          role,
          location: loc.name,
          timezone: loc.isDiaspora ? 'America/Chicago' : 'Africa/Mogadishu',
          isDiaspora: loc.isDiaspora,
          mappedPractices,
          cohortId,
          onboardingCompletedAt,
          createdAt: onboardingCompletedAt,
          updatedAt: onboardingCompletedAt,
        },
        userId: null,
        needsActivity: true,
        onboardingCompletedAt,
      });
    }

    // -----------------------------------------------------------------
    // Phase 2: resolve which users already exist (1 round trip)
    // -----------------------------------------------------------------
    const phoneHashes = plans.map((p) => p.phoneHash);
    const existingUsers = await db
      .select({ id: users.id, phoneHash: users.phoneHash })
      .from(users)
      .where(inArray(users.phoneHash, phoneHashes));
    const byHash = new Map(existingUsers.map((u) => [u.phoneHash, u.id]));
    for (const plan of plans) {
      const existing = byHash.get(plan.phoneHash);
      if (existing !== undefined) {
        plan.userId = existing;
        plan.insertRow = null;
        summary.usersExisting += 1;
      }
    }

    // -----------------------------------------------------------------
    // Phase 3: bulk-insert net-new users (1 round trip)
    // -----------------------------------------------------------------
    const newUserRows = plans.filter((p) => p.insertRow !== null);
    if (newUserRows.length > 0) {
      console.log(`bulk-inserting ${newUserRows.length} net-new users...`);
      const inserted = await db
        .insert(users)
        .values(newUserRows.map((p) => p.insertRow!))
        .returning({ id: users.id, phoneHash: users.phoneHash });
      const insMap = new Map(inserted.map((r) => [r.phoneHash, r.id]));
      for (const plan of plans) {
        if (plan.userId === null) {
          const id = insMap.get(plan.phoneHash);
          if (id === undefined) {
            throw new Error(`bulk insert missed phoneHash for index ${plan.phoneIdx}`);
          }
          plan.userId = id;
          summary.usersCreated += 1;
        }
      }
    }

    // -----------------------------------------------------------------
    // Phase 4: which existing users already have turns? (1 round trip)
    // -----------------------------------------------------------------
    const allUserIds = plans.map((p) => p.userId!);
    const usersWithTurnsRows = await db
      .selectDistinct({ userId: turns.userId })
      .from(turns)
      .where(inArray(turns.userId, allUserIds));
    const usersWithTurns = new Set(usersWithTurnsRows.map((r) => r.userId));
    for (const plan of plans) {
      if (usersWithTurns.has(plan.userId!)) {
        plan.needsActivity = false;
      }
    }

    // -----------------------------------------------------------------
    // Phase 5: synthesize all sessions + turns in memory
    // -----------------------------------------------------------------
    const pendingSessions: PendingSession[] = [];
    for (const plan of plans) {
      if (!plan.needsActivity) {
        continue;
      }
      const userRng = makeRng(`${SEED_TAG}|user|${plan.phoneIdx}`);
      // Burn the same RNG draws that defined the profile so the activity
      // distribution is independent of profile-RNG state.
      for (let burn = 0; burn < 8; burn++) {
        userRng();
      }
      const activityScore = userRng();
      const sessionCount =
        activityScore < 0.15
          ? 1 + Math.floor(userRng() * 2)
          : activityScore < 0.7
            ? 3 + Math.floor(userRng() * 8)
            : 10 + Math.floor(userRng() * 16);
      const userWindowMs = now.getTime() - plan.onboardingCompletedAt.getTime();

      for (let s = 0; s < sessionCount; s++) {
        const sessionRng = makeRng(`${SEED_TAG}|user|${plan.phoneIdx}|sess|${s}`);
        const sessionStartedAt = new Date(
          plan.onboardingCompletedAt.getTime() + sessionRng() * userWindowMs,
        );
        const turnCount = 2 + Math.floor(sessionRng() * 11);

        const pendingTurns: PendingTurn[] = [];
        let lastTurnAt = sessionStartedAt;
        for (let t = 0; t < turnCount; t++) {
          const turnRng = makeRng(`${SEED_TAG}|user|${plan.phoneIdx}|sess|${s}|turn|${t}`);
          const dt = 30_000 + turnRng() * 14 * 60 * 1000;
          const turnAt = new Date(lastTurnAt.getTime() + dt);
          const practice = pickPractice(turnRng);
          summary.practiceDistribution[practice] =
            (summary.practiceDistribution[practice] ?? 0) + 1;
          const isNonApproved = turnRng() < 0.05;
          const qaOutcome = isNonApproved
            ? NON_APPROVED_OUTCOMES[Math.floor(turnRng() * NON_APPROVED_OUTCOMES.length)]!
            : APPROVED_OUTCOMES[Math.floor(turnRng() * APPROVED_OUTCOMES.length)]!;
          summary.qaOutcomeDistribution[qaOutcome] =
            (summary.qaOutcomeDistribution[qaOutcome] ?? 0) + 1;
          const retryCount = qaOutcome === 'E2_ApprovedRegenerated' ? 1 : isNonApproved ? 3 : 0;
          const levelTag = pickWeighted(
            turnRng,
            ['self', 'team', 'organization', 'community'],
            [4, 4, 1.5, 0.5],
          );
          pendingTurns.push({
            userId: plan.userId!,
            practice,
            levelTag,
            qaOutcome,
            retryCount,
            isNonApproved,
            latencyMs: 3500 + Math.floor(turnRng() * 2500),
            createdAt: turnAt,
          });
          lastTurnAt = turnAt;
        }

        pendingSessions.push({
          userPhoneIdx: plan.phoneIdx,
          userId: plan.userId!,
          startedAt: sessionStartedAt,
          lastTurnAt,
          turnCount,
          pendingTurns,
        });
      }
    }

    // -----------------------------------------------------------------
    // Phase 6: bulk-insert sessions (chunked round trips)
    // -----------------------------------------------------------------
    if (pendingSessions.length > 0) {
      console.log(`bulk-inserting ${pendingSessions.length} sessions...`);
      const insertedSessionIds: string[] = [];
      await chunkInsert(pendingSessions, SESSIONS_CHUNK, async (chunk) => {
        const rows = chunk.map((s) => ({
          userId: s.userId,
          startedAt: s.startedAt,
          lastTurnAt: s.lastTurnAt,
          turnCount: s.turnCount,
          metadata: { synthetic: SEED_TAG },
        }));
        const ins = await db.insert(sessions).values(rows).returning({ id: sessions.id });
        for (const r of ins) {
          insertedSessionIds.push(r.id);
        }
      });
      // The returning order matches the insert order, so we can pair sessions
      // with their freshly assigned ids.
      for (let i = 0; i < pendingSessions.length; i++) {
        const sessionId = insertedSessionIds[i];
        if (sessionId === undefined) {
          throw new Error(`session insert returned fewer rows than sent`);
        }
        for (const t of pendingSessions[i]!.pendingTurns) {
          (t as PendingTurn & { sessionId: string }).sessionId = sessionId;
        }
      }
      summary.sessionsCreated += pendingSessions.length;
    }

    // -----------------------------------------------------------------
    // Phase 7: bulk-insert turns (chunked round trips)
    // -----------------------------------------------------------------
    const allTurns = pendingSessions.flatMap(
      (s) => s.pendingTurns as (PendingTurn & { sessionId: string })[],
    );
    if (allTurns.length > 0) {
      console.log(`bulk-inserting ${allTurns.length} turns...`);
      await chunkInsert(allTurns, TURNS_CHUNK, async (chunk) => {
        const rows = chunk.map((t) => ({
          sessionId: t.sessionId,
          userId: t.userId,
          userMessage: 'synthetic',
          responseText: 'synthetic response',
          intent: 'Coaching',
          practiceTag: t.practice,
          levelTag: t.levelTag,
          responseMode: 'FullCoachingResponse',
          modelUsed: 'claude-haiku-4-5',
          fallbackPath: 'none',
          qaOutcome: t.qaOutcome,
          retryCount: t.retryCount,
          latencyMs: t.latencyMs,
          terminalEvent: t.isNonApproved ? 'E11_ServiceUnavailable' : 'E1_TurnCompleted',
          createdAt: t.createdAt,
        }));
        await db.insert(turns).values(rows);
      });
      summary.turnsCreated += allTurns.length;
    }

    // -----------------------------------------------------------------
    // Phase 8: crisis events (3 rows max — direct insert)
    // -----------------------------------------------------------------
    const planByPhone = new Map(plans.map((p) => [p.phoneIdx, p]));
    const crisisRows: (typeof crisisEvents.$inferInsert)[] = [];
    for (const c of CRISIS_PLAN) {
      const userPlan = planByPhone.get(PHONE_FIRST_INDEX + c.userIdx);
      if (userPlan === undefined || userPlan.userId === null) {
        continue;
      }
      const marker = `${SEED_TAG}|${c.triggerSource}|${c.outcomeCategory}`;
      const existing = await db
        .select({ id: crisisEvents.id })
        .from(crisisEvents)
        .where(eq(crisisEvents.errorReason, marker))
        .limit(1);
      if (existing[0] !== undefined) {
        summary.crisisEventsExisting += 1;
        continue;
      }
      // Pull a turn for this user to anchor the crisis row to.
      const userTurn = await db
        .select({
          id: turns.id,
          sessionId: turns.sessionId,
          createdAt: turns.createdAt,
        })
        .from(turns)
        .where(eq(turns.userId, userPlan.userId))
        .limit(1);
      crisisRows.push({
        userId: userPlan.userId,
        sessionId: userTurn[0]?.sessionId ?? null,
        turnId: userTurn[0]?.id ?? null,
        triggerSource: c.triggerSource,
        outcomeCategory: c.outcomeCategory,
        resourcesVersion: 'v2',
        errorReason: marker,
        createdAt: userTurn[0]?.createdAt ?? new Date(now.getTime() - 24 * 60 * 60 * 1000),
      });
    }
    if (crisisRows.length > 0) {
      await db.insert(crisisEvents).values(crisisRows);
      summary.crisisEventsCreated += crisisRows.length;
    }

    // -----------------------------------------------------------------
    // Phase 9: access codes (so the dashboard's seats overview matches
    // the user count rather than showing 0/100 redeemed).
    // 60 redeemed (one per synthetic user) + 25 unredeemed + 8 expired
    // + 2 revoked = 95 codes against the 100-seat cohort budget.
    // -----------------------------------------------------------------
    const codePrefix = `${SEED_TAG}|`;
    const existingCodes = await db
      .select({ id: accessCodes.id })
      .from(accessCodes)
      .where(eq(accessCodes.cohortId, cohortId))
      .limit(1);
    if (existingCodes[0] === undefined) {
      const codeRows: (typeof accessCodes.$inferInsert)[] = [];
      let codeIdx = 0;
      // Redeemed — one per synthetic user, redemption time near their
      // onboarding completion.
      for (const plan of plans) {
        if (plan.userId === null) {
          continue;
        }
        codeRows.push({
          code: `${codePrefix}r-${String(codeIdx).padStart(4, '0')}`,
          cohortId,
          status: 'redeemed',
          redeemedUserId: plan.userId,
          redeemedAt: plan.onboardingCompletedAt,
          generationNote: SEED_TAG,
        });
        codeIdx += 1;
      }
      // Unredeemed.
      for (let i = 0; i < 25; i++) {
        codeRows.push({
          code: `${codePrefix}u-${String(codeIdx).padStart(4, '0')}`,
          cohortId,
          status: 'unredeemed',
          generationNote: SEED_TAG,
        });
        codeIdx += 1;
      }
      // Expired.
      for (let i = 0; i < 8; i++) {
        codeRows.push({
          code: `${codePrefix}e-${String(codeIdx).padStart(4, '0')}`,
          cohortId,
          status: 'expired',
          generationNote: SEED_TAG,
        });
        codeIdx += 1;
      }
      // Revoked.
      for (let i = 0; i < 2; i++) {
        codeRows.push({
          code: `${codePrefix}v-${String(codeIdx).padStart(4, '0')}`,
          cohortId,
          status: 'revoked',
          generationNote: SEED_TAG,
        });
        codeIdx += 1;
      }
      await chunkInsert(codeRows, 500, async (chunk) => {
        await db.insert(accessCodes).values(chunk);
      });
      console.log(`bulk-inserted ${codeRows.length} access codes`);
    } else {
      console.log('access codes already present for this cohort — skipping');
    }

    printSummary(summary);
  } finally {
    await close();
  }
}

function printSummary(s: SeedSummary): void {
  console.log('\n=== seed summary ===');
  console.log(`users created    : ${s.usersCreated}`);
  console.log(`users existing   : ${s.usersExisting}`);
  console.log(`sessions created : ${s.sessionsCreated}`);
  console.log(`turns created    : ${s.turnsCreated}`);
  console.log(`crisis created   : ${s.crisisEventsCreated} (existing ${s.crisisEventsExisting})`);
  console.log(`diaspora users   : ${s.diasporaCount}`);
  console.log('\nrole distribution:');
  for (const [k, v] of Object.entries(s.roleDistribution).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(15)} ${v}`);
  }
  console.log('\nlocation distribution:');
  for (const [k, v] of Object.entries(s.locationDistribution).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(15)} ${v}`);
  }
  console.log('\npractice distribution (across all turns):');
  const total = Object.values(s.practiceDistribution).reduce((a, b) => a + b, 0) || 1;
  for (const [k, v] of Object.entries(s.practiceDistribution).sort((a, b) => b[1] - a[1])) {
    const pct = ((v / total) * 100).toFixed(1);
    console.log(`  ${k.padEnd(15)} ${String(v).padStart(5)} (${pct}%)`);
  }
  console.log('\nqa outcome distribution:');
  const totalQa = Object.values(s.qaOutcomeDistribution).reduce((a, b) => a + b, 0) || 1;
  for (const [k, v] of Object.entries(s.qaOutcomeDistribution).sort((a, b) => b[1] - a[1])) {
    const pct = ((v / totalQa) * 100).toFixed(1);
    console.log(`  ${k.padEnd(28)} ${String(v).padStart(5)} (${pct}%)`);
  }
}

main().catch((err: unknown) => {
  console.error('seed-realistic-cohort-data fatal:', err);
  process.exit(1);
});
