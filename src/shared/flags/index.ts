import type { AppConfig } from '../secrets/config.js';

/**
 * Feature flags for the context-and-connections build plan.
 *
 * Every new user-facing capability is behind one of these. Each defaults to
 * OFF in every environment, so merging the code changes nothing until someone
 * sets the env var. Demo mode (DEMO_MODE=true, never production) defaults
 * them ON so the owner can click through everything; an explicit env value
 * still wins.
 */
export const FEATURE_FLAGS = {
  leaderBrief: 'FEATURE_LEADER_BRIEF', // P1.1–P1.3 leader brief + "What Hogaan knows"
  knowledgeDigest: 'FEATURE_KNOWLEDGE_DIGEST', // P1.4 cached knowledge block
  moments: 'FEATURE_MOMENTS', // P2.1 / P2.3 moments + outcome capture
  followUpEmail: 'FEATURE_FOLLOWUP_EMAIL', // P2.2 follow-up email after a moment
  ratings: 'FEATURE_RATINGS', // P2.4 helpful / not helpful
  weeklyNudge: 'FEATURE_WEEKLY_NUDGE', // P2.6 opt-in weekly nudge
  mcp: 'FEATURE_MCP', // P3 Hogaan MCP server
  billing: 'FEATURE_BILLING', // P4 subscriptions + free-tier limits
  orgs: 'FEATURE_ORGS', // P5 organizations, cohorts, funder report
  meetingNotes: 'FEATURE_MEETING_NOTES', // P6.2 paste meeting notes into a reflection
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

function parseBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw === '') return undefined;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'on' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false;
  return undefined;
}

export function readFeatureFlags(
  env: Record<string, string | undefined>,
  demoMode: boolean,
): Record<FeatureFlag, boolean> {
  const out = {} as Record<FeatureFlag, boolean>;
  for (const [flag, envName] of Object.entries(FEATURE_FLAGS) as [FeatureFlag, string][]) {
    out[flag] = parseBool(env[envName]) ?? demoMode;
  }
  return out;
}

export function isEnabled(config: Pick<AppConfig, 'features'>, flag: FeatureFlag): boolean {
  return config.features?.[flag] === true;
}

/** Public projection for the browser (`GET /api/features`). */
export function featureSnapshot(
  config: Pick<AppConfig, 'features' | 'demoMode'>,
): Record<FeatureFlag, boolean> & { demoMode: boolean } {
  const out = { demoMode: config.demoMode === true } as Record<FeatureFlag, boolean> & {
    demoMode: boolean;
  };
  for (const flag of Object.keys(FEATURE_FLAGS) as FeatureFlag[]) {
    out[flag] = isEnabled(config, flag);
  }
  return out;
}
