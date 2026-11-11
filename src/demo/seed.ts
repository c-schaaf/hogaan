import { eq } from 'drizzle-orm';
import {
  promptTemplatesV2Unified,
  publishLibraryVersion,
  dailyPromptsV1,
} from '../libraries/index.js';
import type { Database } from '../shared/db/client.js';
import { encryptPlaintext } from '../shared/db/encryption.js';
import { sessions } from '../shared/db/schema/sessions.js';
import { turns } from '../shared/db/schema/turns.js';
import { users } from '../shared/db/schema/users.js';
import { subscriptions } from '../shared/db/schema/billing.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { DEMO_SUPABASE_USER_ID } from '../web-api/supabase-session.js';
import { KNOWLEDGE_DIGEST_PLACEHOLDER } from '../libraries/knowledge-digest.js';
import { getBrief, saveBrief } from '../leader-context/store.js';
import { runBriefUpdate } from '../leader-context/updater.js';
import { createMoment, recordExtractedMoments, recordOutcome } from '../moments/store.js';
import { createCohort, createInvite, createOrg, joinByCode, verifyOrg } from '../orgs/store.js';
import { setPrefs } from '../shared/email/proactive.js';
import { scheduleWeeklyNudge } from '../jobs/phase2-handlers.js';
import { isEnabled } from '../shared/flags/index.js';

/**
 * Seed data for DEMO MODE. One fictional sample leader ("Amina"), a few past
 * sessions, and the library rows the coach needs. Library payloads are the
 * repo's existing seed content, read as-is (Hard Rule 2: not edited).
 *
 * Later phases append to this file so each new feature has something to
 * show on first load.
 */
export const DEMO_EMAIL = 'amina.demo@example.com';
export const DEMO_FULL_NAME = 'Amina Farah';

const DAY = 24 * 60 * 60 * 1000;

export async function seedDemo(db: Database, config: AppConfig): Promise<{ userId: string }> {
  await publishLibraryVersion(db, {
    libraryName: 'prompt_templates',
    version: 'v3_leadership_tune2_plain_prose',
    payload: promptTemplatesV2Unified,
    publishedBy: 'system:demo-seed',
    notes: 'demo mode — same payload the production publish script uses',
    makeActive: true,
  });
  await publishLibraryVersion(db, {
    libraryName: 'daily_prompts',
    version: 'v1',
    payload: dailyPromptsV1,
    publishedBy: 'system:demo-seed',
    makeActive: true,
  });

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.supabaseUserId, DEMO_SUPABASE_USER_ID))
    .limit(1);
  if (existing[0] !== undefined) return { userId: existing[0].id };

  const inserted = await db
    .insert(users)
    .values({
      email: DEMO_EMAIL,
      supabaseUserId: DEMO_SUPABASE_USER_ID,
      fullNameEncrypted: encryptPlaintext(config, DEMO_FULL_NAME),
      status: 'onboarded',
      experienceBand: '5-10',
      timezone: 'America/Chicago',
      mappedPractices: ['Integrity', 'Empathy', 'Inclusion'],
      onboardingCompletedAt: new Date(Date.now() - 20 * DAY),
      emailVerifiedAt: new Date(Date.now() - 20 * DAY),
    })
    .returning({ id: users.id });
  const userId = inserted[0]!.id;

  const past: { daysAgo: number; title: string; exchange: [string, string][] }[] = [
    {
      daysAgo: 9,
      title: 'Giving hard feedback to a senior analyst',
      exchange: [
        [
          "I'm a program manager at a housing nonprofit. I manage a team of six. One of my senior analysts keeps missing deadlines and I have been avoiding the conversation.",
          'It sounds like you care about this person and also about the team carrying the load. What have you noticed about when the deadlines slip?',
        ],
        [
          'Mostly when the work depends on another department. I think she is stuck but will not say so.',
          'That is a useful observation. Integrity here might mean naming what you see without blame. What would you want her to feel when she walks out of that conversation?',
        ],
      ],
    },
    {
      daysAgo: 3,
      title: 'Preparing to ask my director for headcount',
      exchange: [
        [
          'I want to ask my director for one more hire before the grant cycle. She tends to say no to anything that is not in the budget.',
          'You are preparing to manage up on something that matters for your team. What does your director care most about this quarter?',
        ],
      ],
    },
  ];

  const seededSessionIds: string[] = [];
  for (const p of past) {
    const at = new Date(Date.now() - p.daysAgo * DAY);
    const s = await db
      .insert(sessions)
      .values({
        userId,
        startedAt: at,
        lastTurnAt: at,
        turnCount: p.exchange.length,
        title: p.title,
      })
      .returning({ id: sessions.id });
    const sessionId = s[0]!.id;
    seededSessionIds.push(sessionId);
    let i = 0;
    for (const [u, a] of p.exchange) {
      await db.insert(turns).values({
        sessionId,
        userId,
        userMessage: u,
        responseText: a,
        modelUsed: 'scripted-demo',
        latencyMs: 0,
        createdAt: new Date(at.getTime() + i++ * 60_000),
      });
    }
  }
  await publishLibraryVersion(db, {
    libraryName: 'knowledge_digest',
    version: 'placeholder-v0',
    payload: KNOWLEDGE_DIGEST_PLACEHOLDER,
    publishedBy: 'system:demo-seed',
    notes: 'mechanism only; awaiting founder-approved content (Hard Rule 2)',
    makeActive: true,
  });

  // P1.1 — build Amina's brief from her past sessions (scripted extraction
  // in demo mode), so her next session opens with context.
  if (isEnabled(config, 'leaderBrief')) {
    for (const sessionId of seededSessionIds) {
      const res = await runBriefUpdate(config, db, { userId, sessionId });
      if (isEnabled(config, 'moments')) {
        await recordExtractedMoments(config, db, userId, sessionId, res.moments ?? []);
      }
    }
    // The scripted extraction only fills a couple of fields. Complete the
    // sample leader's work context so the demo shows a realistic profile.
    const brief = await getBrief(config, db, userId);
    await saveBrief(
      config,
      db,
      userId,
      {
        ...brief,
        profileFields: {
          ...brief.profileFields,
          title: 'Program manager',
          industry: 'Affordable housing',
          orgType: 'Nonprofit',
          orgSize: 'About 40 people',
          teamShape: 'A team of six; two joined this quarter',
          coachingPreference: 'Direct questions, short answers',
        },
      },
      { updatedBy: 'demo-seed' },
    );
  }
  // P4 — Amina starts on Personal (demo ids, no Stripe) so every feature is
  // visible; "Cancel plan (demo)" on Profile shows the Free limits.
  if (isEnabled(config, 'billing')) {
    await db
      .insert(subscriptions)
      .values({
        userId,
        plan: 'personal',
        status: 'active',
        stripeCustomerId: 'cus_demo',
        stripeSubscriptionId: `sub_demo_${userId.slice(0, 8)}`,
        currentPeriodEnd: new Date(Date.now() + 30 * DAY),
      })
      .onConflictDoNothing();
  }

  // P2 — Amina opted in to check-ins; one moment is ready for a follow-up
  // and reflection, one is coming up.
  if (isEnabled(config, 'followUpEmail') || isEnabled(config, 'weeklyNudge')) {
    await setPrefs(db, userId, {
      followupEmailOptIn: isEnabled(config, 'followUpEmail'),
      weeklyNudgeOptIn: isEnabled(config, 'weeklyNudge'),
    });
    if (isEnabled(config, 'weeklyNudge')) await scheduleWeeklyNudge(db, userId);
  }
  if (isEnabled(config, 'moments')) {
    const yesterday = new Date(Date.now() - DAY);
    yesterday.setHours(14, 0, 0, 0);
    await createMoment(config, db, userId, {
      what: 'Headcount conversation',
      withWhom: 'my director',
      happensAt: yesterday,
      source: 'leader',
    });
    const soon = new Date(Date.now() + 2 * DAY);
    soon.setHours(10, 0, 0, 0);
    await createMoment(config, db, userId, {
      what: 'Deadline check-in with senior analyst',
      withWhom: 'a senior analyst on my team',
      happensAt: soon,
      source: 'leader',
    });
  }
  // P5 — a verified funder with two cohorts. In the demo Amina is the
  // funder's admin (sponsors may not join their own cohorts); the leader side
  // is visible on her Profile ("Sponsored programs").
  if (isEnabled(config, 'orgs')) await seedOrgs(config, db, userId);
  return { userId };
}

async function seedOrgs(config: AppConfig, db: Database, aminaId: string): Promise<void> {
  const org = await createOrg(db, aminaId, { name: 'Example Leadership Fund', kind: 'funder' });
  const fellows = await createCohort(db, org.id, { name: 'Fall 2026 Fellows', seatLimit: 50 });
  const pilot = await createCohort(db, org.id, { name: 'Spring pilot', seatLimit: 10 });
  const fellowsCode = await createInvite(db, fellows.id);
  const pilotCode = await createInvite(db, pilot.id);
  await verifyOrg(db, org.id);
  const practices = ['Integrity', 'Empathy', 'Inclusion', 'Purpose', 'Accountability', 'Peace'];
  const outcomes = ['well', 'mixed', 'hard', 'well'] as const;
  for (let i = 0; i < 17; i++) {
    const inFellows = i < 11;
    const u = await db
      .insert(users)
      .values({
        email: `sample${i}@example.com`,
        fullNameEncrypted: encryptPlaintext(config, `Sample Leader${i}`),
        status: 'onboarded',
        mappedPractices: [practices[i % practices.length]!, practices[(i + 2) % practices.length]!],
      })
      .returning({ id: users.id });
    const id = u[0]!.id;
    await joinByCode(db, id, inFellows ? fellowsCode : pilotCode);
    for (let k = 0; k < 1 + (i % 3); k++) {
      await db.insert(sessions).values({ userId: id, turnCount: 3, title: 'sample session' });
    }
    if (inFellows && i % 2 === 0) {
      const m = await createMoment(config, db, id, {
        what: `Sample conversation ${i}`,
        source: 'leader',
        happensAt: new Date(Date.now() - 2 * DAY),
      });
      if (m !== null) {
        await recordOutcome(config, db, id, m.id, {
          howItWent: outcomes[i % outcomes.length]!,
          confidenceBefore: 2 + (i % 2),
          confidenceAfter: 4,
        });
      }
    }
  }
}
