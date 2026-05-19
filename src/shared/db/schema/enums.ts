import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * User lifecycle states. Process #1 transitions:
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

export const suppressionReason = pgEnum('suppression_reason', [
  'opt_out',
  'block',
  'bounce',
  'abuse',
]);

export const libraryName = pgEnum('library_name', [
  'prompt_templates',
  'voice_rules',
  'cultural_framing',
  'crisis_resources',
  'scenarios',
  'daily_prompts',
]);

export const triggerSource = pgEnum('trigger_source', ['whatsapp', 'web_session', 'web_signup']);
