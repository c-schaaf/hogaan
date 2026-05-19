import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * User lifecycle states.
 *   provisional → onboarding_started → onboarded
 *                                    → onboarding_dormant (after 7d idle) → onboarded
 *                                    → consent_declined (terminal)
 *                                    → opted_out (terminal)
 *                                    → onboarding_error (terminal, recoverable via support)
 */
export const userStatus = pgEnum('user_status', [
  'provisional',
  'onboarding_started',
  'onboarding_dormant',
  'onboarded',
  'consent_declined',
  'opted_out',
  'blocked',
  'onboarding_error',
]);

export const libraryName = pgEnum('library_name', [
  'prompt_templates',
  'voice_rules',
  'cultural_framing',
  'crisis_resources',
  'scenarios',
  'daily_prompts',
]);

/**
 * Identity audit-log trigger source. The 'whatsapp' value remains in the
 * Postgres enum for append-only audit history compliance (CLAUDE.md hard
 * rule #3), but new writers may only use the values declared here.
 */
export const triggerSource = pgEnum('trigger_source', ['web_session', 'web_signup']);
