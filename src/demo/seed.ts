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
import type { AppConfig } from '../shared/secrets/config.js';
import { DEMO_SUPABASE_USER_ID } from '../web-api/supabase-session.js';

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
          'One of my senior analysts keeps missing deadlines and I have been avoiding the conversation. I manage a team of six at a housing nonprofit.',
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
  return { userId };
}
