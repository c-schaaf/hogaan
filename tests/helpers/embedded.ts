import { createEmbeddedDb, type EmbeddedDb } from '../../src/shared/db/embedded.js';
import { fakeConfig } from '../phase-10/helpers/fakes.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';

/** Real Postgres (PGlite) with all migrations applied. One per test file. */
export async function embeddedTestDb(): Promise<EmbeddedDb> {
  return createEmbeddedDb();
}

export function demoTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return fakeConfig({
    nodeEnv: 'test',
    demoMode: true,
    anthropicApiKey: undefined,
    features: {
      leaderBrief: true,
      knowledgeDigest: true,
      moments: true,
      followUpEmail: true,
      ratings: true,
      weeklyNudge: true,
      mcp: true,
      billing: true,
      orgs: true,
      meetingNotes: true,
    },
    emailLinkSecret: 'test-link-secret',
    briefUpdateDelayMs: 0,
    ...overrides,
  });
}
