import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { issueSponsorSessionToken, requestMagicLink } from '../src/sponsor-portal/index.js';
import { upsertSponsorUser } from '../src/sponsor-portal/auth/magic-link.js';
import { getDb } from '../src/shared/db/client.js';
import { encryptPlaintext, hashPhone } from '../src/shared/db/encryption.js';
import { accessCodes } from '../src/shared/db/schema/access-codes.js';
import { cohorts } from '../src/shared/db/schema/cohorts.js';
import { sessions } from '../src/shared/db/schema/sessions.js';
import { sponsors } from '../src/shared/db/schema/sponsors.js';
import { sponsorUsers } from '../src/shared/db/schema/sponsor-users.js';
import { turns } from '../src/shared/db/schema/turns.js';
import { users } from '../src/shared/db/schema/users.js';
import { wireSponsorPortalRoutes } from '../src/sponsor-portal/setup.js';
import { loadConfig } from '../src/shared/secrets/config.js';

/**
 * Phase 9A verification harness.
 *
 *   pnpm exec tsx scripts/verify-phase-9.ts
 *
 * Provisions:
 *   - 1 sponsor + 1 sponsor_admin sponsor user + 1 hogaan_ops sponsor user
 *   - cohort "main" with 30 onboarded users (each with sample turns + a session)
 *   - cohort "small" with 29 onboarded users (each with sample turns)
 *
 * Then exercises:
 *   1. Magic-link request → returns 'ok' (does NOT actually send email
 *      unless RESEND_API_KEY is set; the request endpoint is hit so we
 *      verify the code path runs)
 *   2. Issue a session token directly (bypassing email) for the sponsor_admin,
 *      hit GET /api/sponsor/dashboard, /api/sponsor/engagement, /api/sponsor/qc
 *      via app.inject — assert all return 200 with non-suppressed data on
 *      the main cohort
 *   3. Subdivide: build a different sponsor with the small (29-user) cohort,
 *      issue a token scoped to it, hit the same endpoints — assert the
 *      engagement summary, retention, practices, qc, and crisis segments
 *      are all SUPPRESSED with the locked sentinel copy
 *   4. RBAC: with sponsor_admin token bound to sponsor A, ensure /api/sponsor/dashboard
 *      cohortCount reflects ONLY sponsor A's cohorts (1, the main one).
 *      With hogaan_ops token, cohortCount reflects all cohorts (main + small).
 *
 * Cleanup: leaves test rows in place. Re-running is idempotent (looks up
 * existing test sponsor by legal_name and reuses).
 */

const SPONSOR_NAME_A = 'Phase 9 Verify Sponsor (main)';
const SPONSOR_NAME_B = 'Phase 9 Verify Sponsor (small)';
const COHORT_MAIN = 'Phase 9 Main Cohort (>=30)';
const COHORT_SMALL = 'Phase 9 Small Cohort (29)';
const TEST_EMAIL_ADMIN_A = 'phase9-admin-a@hogaan-test.local';
const TEST_EMAIL_ADMIN_B = 'phase9-admin-b@hogaan-test.local';
const TEST_EMAIL_OPS = 'phase9-ops@hogaan-test.local';

async function ensureSponsor(db: ReturnType<typeof getDb>['db'], name: string): Promise<string> {
  const existing = await db
    .select({ id: sponsors.id })
    .from(sponsors)
    .where(eq(sponsors.legalName, name))
    .limit(1);
  if (existing[0] !== undefined) {
    return existing[0].id;
  }
  const ins = await db
    .insert(sponsors)
    .values({ legalName: name, primaryContactEmail: 'verify@hogaan-test.local' })
    .returning({ id: sponsors.id });
  return ins[0]!.id;
}

async function ensureCohort(
  db: ReturnType<typeof getDb>['db'],
  sponsorId: string,
  name: string,
): Promise<string> {
  const existing = await db
    .select({ id: cohorts.id })
    .from(cohorts)
    .where(eq(cohorts.name, name))
    .limit(1);
  if (existing[0] !== undefined) {
    return existing[0].id;
  }
  const ins = await db
    .insert(cohorts)
    .values({
      sponsorId,
      name,
      seatCount: 50,
      redemptionWindowStart: new Date('2026-01-01'),
      redemptionWindowEnd: new Date('2027-01-01'),
      seatDurationDays: 365,
      targetGeography: 'Mogadishu',
    })
    .returning({ id: cohorts.id });
  return ins[0]!.id;
}

async function ensureUsersInCohort(
  db: ReturnType<typeof getDb>['db'],
  config: ReturnType<typeof loadConfig>,
  cohortId: string,
  count: number,
  prefix: string,
): Promise<void> {
  // Re-use users by phone_hash if they exist; otherwise create. The audit_log
  // append-only trigger blocks SET NULL cascades, so we never DELETE users.
  for (let i = 0; i < count; i++) {
    const phone = `${prefix}${String(i).padStart(4, '0')}`;
    const phoneHash = hashPhone(phone);
    const phoneEncrypted = encryptPlaintext(config, phone);
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phoneHash, phoneHash))
      .limit(1);
    let userId: string;
    if (existing[0] !== undefined) {
      userId = existing[0].id;
      await db
        .update(users)
        .set({ status: 'onboarded', cohortId, phoneEncrypted })
        .where(eq(users.id, userId));
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
          cohortId,
          onboardingCompletedAt: new Date(),
        })
        .returning({ id: users.id });
      userId = ins[0]!.id;
    }

    // Ensure a session and a small fixed number of turns exist.
    const sessRow = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .limit(1);
    let sessionId: string;
    if (sessRow[0] !== undefined) {
      sessionId = sessRow[0].id;
    } else {
      const sIns = await db
        .insert(sessions)
        .values({ userId, turnCount: 0, lastTurnAt: new Date() })
        .returning({ id: sessions.id });
      sessionId = sIns[0]!.id;
    }

    const existingTurns = await db
      .select({ id: turns.id })
      .from(turns)
      .where(eq(turns.userId, userId))
      .limit(1);
    if (existingTurns[0] === undefined) {
      // Each user gets 3 turns spread across practices for distribution.
      const practices = ['integrity', 'empathy', 'peace'];
      for (let t = 0; t < 3; t++) {
        await db.insert(turns).values({
          sessionId,
          userId,
          userMessage: 'synthetic',
          responseText: 'synthetic response',
          intent: 'Coaching',
          practiceTag: practices[t % practices.length]!,
          levelTag: 'self',
          responseMode: 'FullCoachingResponse',
          modelUsed: 'claude-haiku-4-5',
          fallbackPath: 'none',
          qaOutcome: t === 0 ? 'E1_ApprovedFirstAttempt' : 'E2_ApprovedRegenerated',
          retryCount: t === 0 ? 0 : 1,
          latencyMs: 4500,
          terminalEvent: 'E1_TurnCompleted',
        });
      }
    }
  }
}

async function ensureCodeOnCohort(
  db: ReturnType<typeof getDb>['db'],
  cohortId: string,
  count: number,
): Promise<void> {
  // Issue + redeem a few codes so the seats overview has activity.
  for (let i = 0; i < count; i++) {
    const code = `phase9-${cohortId.slice(0, 6)}-${i}`;
    const existing = await db
      .select({ id: accessCodes.id })
      .from(accessCodes)
      .where(eq(accessCodes.code, code))
      .limit(1);
    if (existing[0] === undefined) {
      await db.insert(accessCodes).values({
        code,
        cohortId,
        status: i < count - 1 ? 'redeemed' : 'unredeemed',
        ...(i < count - 1 ? { redeemedAt: new Date() } : {}),
      });
    }
  }
}

interface Step {
  name: string;
  ok: boolean;
  detail: string;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, close } = getDb(config);
  const steps: Step[] = [];
  const log = (s: Step): void => {
    steps.push(s);
    console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.name} — ${s.detail}`);
  };

  try {
    console.log('\n=== Phase 9A verification ===\n');
    console.log('--- provisioning ---');

    const sponsorAId = await ensureSponsor(db, SPONSOR_NAME_A);
    const sponsorBId = await ensureSponsor(db, SPONSOR_NAME_B);
    const cohortMainId = await ensureCohort(db, sponsorAId, COHORT_MAIN);
    const cohortSmallId = await ensureCohort(db, sponsorBId, COHORT_SMALL);
    console.log('  sponsorA / cohortMain:', sponsorAId, '/', cohortMainId);
    console.log('  sponsorB / cohortSmall:', sponsorBId, '/', cohortSmallId);

    await ensureUsersInCohort(db, config, cohortMainId, 30, '+254700090');
    await ensureUsersInCohort(db, config, cohortSmallId, 29, '+254700091');
    await ensureCodeOnCohort(db, cohortMainId, 12);
    await ensureCodeOnCohort(db, cohortSmallId, 6);

    const adminA = await upsertSponsorUser(db, {
      email: TEST_EMAIL_ADMIN_A,
      role: 'sponsor_admin',
      sponsorId: sponsorAId,
    });
    const adminB = await upsertSponsorUser(db, {
      email: TEST_EMAIL_ADMIN_B,
      role: 'sponsor_admin',
      sponsorId: sponsorBId,
    });
    const ops = await upsertSponsorUser(db, {
      email: TEST_EMAIL_OPS,
      role: 'hogaan_ops',
      sponsorId: null,
    });
    console.log('  sponsor users:', { adminA: adminA.id, adminB: adminB.id, ops: ops.id });

    // ----- 1. Magic-link request -------------------------------------------
    console.log('\n--- 1. magic-link request ---');
    const r = await requestMagicLink({ config, db }, TEST_EMAIL_ADMIN_A);
    log({
      name: 'magic-link request returns ok status',
      ok: r.status === 'ok',
      detail: `status=${r.status}; email send actually attempted only if RESEND_API_KEY set`,
    });

    // ----- 2. Boot the app + register routes -------------------------------
    console.log('\n--- 2. boot app + register sponsor portal routes ---');
    const app = await buildApp(config);
    const wired = await wireSponsorPortalRoutes(app, config);
    log({
      name: 'sponsor portal routes wired',
      ok: wired.registered,
      detail: wired.reason ?? 'ok',
    });
    if (!wired.registered) {
      throw new Error(`Cannot continue: routes not registered: ${wired.reason}`);
    }

    // ----- 3. Issue session tokens ----------------------------------------
    const tokenAdminA = await issueSponsorSessionToken(config, {
      sponsorUserId: adminA.id,
      role: 'sponsor_admin',
      sponsorId: sponsorAId,
      email: TEST_EMAIL_ADMIN_A,
    });
    const tokenAdminB = await issueSponsorSessionToken(config, {
      sponsorUserId: adminB.id,
      role: 'sponsor_admin',
      sponsorId: sponsorBId,
      email: TEST_EMAIL_ADMIN_B,
    });
    const tokenOps = await issueSponsorSessionToken(config, {
      sponsorUserId: ops.id,
      role: 'hogaan_ops',
      sponsorId: null,
      email: TEST_EMAIL_OPS,
    });

    // ----- 4. Sponsor A (main cohort, ≥30 users): segments visible ---------
    console.log('\n--- 3. sponsor_admin (sponsorA, main cohort) — visible ---');
    const dashA = await app.inject({
      method: 'GET',
      url: '/api/sponsor/dashboard',
      headers: { authorization: `Bearer ${tokenAdminA}` },
    });
    const dashABody = dashA.json() as {
      cohortCount: number;
      distinctUsers: number;
      seats: unknown[];
    };
    log({
      name: 'sponsor_admin dashboard 200 + only own cohorts',
      ok: dashA.statusCode === 200 && dashABody.cohortCount === 1,
      detail: `status=${dashA.statusCode} cohortCount=${dashABody.cohortCount} distinctUsers=${dashABody.distinctUsers}`,
    });

    const engA = await app.inject({
      method: 'GET',
      url: '/api/sponsor/engagement',
      headers: { authorization: `Bearer ${tokenAdminA}` },
    });
    const engABody = engA.json() as {
      summary: { suppressed: boolean };
      retention: { suppressed: boolean };
      practices: { suppressed: boolean };
    };
    log({
      name: 'sponsor_admin engagement summary visible (≥30 users)',
      ok:
        engA.statusCode === 200 &&
        engABody.summary.suppressed === false &&
        engABody.retention.suppressed === false,
      detail: `summary.suppressed=${engABody.summary.suppressed} retention.suppressed=${engABody.retention.suppressed} practices.suppressed=${engABody.practices.suppressed}`,
    });

    const qcA = await app.inject({
      method: 'GET',
      url: '/api/sponsor/qc',
      headers: { authorization: `Bearer ${tokenAdminA}` },
    });
    const qcABody = qcA.json() as {
      qc: { suppressed: boolean };
      crisis: { suppressed: boolean };
    };
    log({
      name: 'sponsor_admin QC summary visible',
      ok: qcA.statusCode === 200 && qcABody.qc.suppressed === false,
      detail: `qc.suppressed=${qcABody.qc.suppressed} crisis.suppressed=${qcABody.crisis.suppressed}`,
    });

    // ----- 5. Sponsor B (small cohort, 29 users): segments suppressed ------
    console.log('\n--- 4. sponsor_admin (sponsorB, small cohort 29 users) — suppressed ---');
    const engB = await app.inject({
      method: 'GET',
      url: '/api/sponsor/engagement',
      headers: { authorization: `Bearer ${tokenAdminB}` },
    });
    const engBBody = engB.json() as {
      summary: {
        suppressed: boolean;
        copy?: string;
        observedDistinctUsers?: number;
        floor?: number;
      };
      retention: { suppressed: boolean };
      practices: { suppressed: boolean };
    };
    const expectedCopy =
      'Segment too small to display \u2014 we protect individual users by suppressing groups smaller than 30.';
    const suppressedAndCopyMatches =
      engBBody.summary.suppressed === true && engBBody.summary.copy === expectedCopy;
    log({
      name: 'sponsor_admin (29-user cohort) engagement segments are SUPPRESSED with locked copy',
      ok: suppressedAndCopyMatches,
      detail: `summary.suppressed=${engBBody.summary.suppressed} observed=${engBBody.summary.observedDistinctUsers} floor=${engBBody.summary.floor} copyMatchesLocked=${engBBody.summary.copy === expectedCopy}`,
    });
    log({
      name: 'sponsor_admin (29-user cohort) retention + practices also SUPPRESSED',
      ok: engBBody.retention.suppressed === true && engBBody.practices.suppressed === true,
      detail: `retention.suppressed=${engBBody.retention.suppressed} practices.suppressed=${engBBody.practices.suppressed}`,
    });
    const qcB = await app.inject({
      method: 'GET',
      url: '/api/sponsor/qc',
      headers: { authorization: `Bearer ${tokenAdminB}` },
    });
    const qcBBody = qcB.json() as {
      qc: { suppressed: boolean };
      crisis: { suppressed: boolean };
    };
    log({
      name: 'sponsor_admin (29-user cohort) qc + crisis SUPPRESSED',
      ok: qcBBody.qc.suppressed === true && qcBBody.crisis.suppressed === true,
      detail: `qc.suppressed=${qcBBody.qc.suppressed} crisis.suppressed=${qcBBody.crisis.suppressed}`,
    });

    // ----- 6. RBAC: hogaan_ops sees both sponsors --------------------------
    console.log('\n--- 5. RBAC: hogaan_ops scope ---');
    const dashOps = await app.inject({
      method: 'GET',
      url: '/api/sponsor/dashboard',
      headers: { authorization: `Bearer ${tokenOps}` },
    });
    const dashOpsBody = dashOps.json() as {
      cohortCount: number;
      distinctUsers: number;
    };
    log({
      name: 'hogaan_ops dashboard sees BOTH cohorts',
      ok: dashOps.statusCode === 200 && dashOpsBody.cohortCount >= 2,
      detail: `status=${dashOps.statusCode} cohortCount=${dashOpsBody.cohortCount} distinctUsers=${dashOpsBody.distinctUsers}`,
    });

    // ----- 7. RBAC: unauthenticated request rejected -----------------------
    console.log('\n--- 6. RBAC: unauthenticated rejected ---');
    const unauthed = await app.inject({
      method: 'GET',
      url: '/api/sponsor/dashboard',
    });
    log({
      name: 'unauthenticated request rejected with 401',
      ok: unauthed.statusCode === 401,
      detail: `status=${unauthed.statusCode}`,
    });

    await app.close();
  } finally {
    await close();
  }

  console.log('\n=== summary ===');
  let passed = 0;
  for (const s of steps) {
    if (s.ok) passed += 1;
  }
  console.log(`${passed}/${steps.length} checks passed`);
  if (passed !== steps.length) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('verify-phase-9 fatal:', err);
  process.exit(1);
});
