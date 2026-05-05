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

export const accessCodeStatus = pgEnum('access_code_status', [
  'unredeemed',
  'redeemed',
  'expired',
  'revoked',
]);

export const whatsappDirection = pgEnum('whatsapp_direction', ['inbound', 'outbound']);

export const whatsappMessageType = pgEnum('whatsapp_message_type', ['free_form', 'template']);

export const whatsappPriority = pgEnum('whatsapp_priority', ['Normal', 'High', 'Critical']);

/**
 * Process #11 dispatch status:
 *   queued → dispatching → sent → delivered → read
 *                            → failed (terminal)
 */
export const whatsappStatus = pgEnum('whatsapp_status', [
  'queued',
  'dispatching',
  'sent',
  'delivered',
  'read',
  'failed',
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
