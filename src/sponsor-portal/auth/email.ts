import { sendEmail as sendEmailShared, type SendOptions, type SendResult } from '../../shared/email/resend.js';
import type { AppConfig } from '../../shared/secrets/config.js';

/**
 * Phase 9A.1 - Resend transport for the magic-link email.
 *
 * As of Phase B (web app) the underlying Resend POST lives in
 * src/shared/email/resend.ts and is shared between the sponsor portal and
 * the end-user web app. This file preserves the existing call signature so
 * sponsor-portal/auth/magic-link.ts doesn't need to change.
 */

export type { SendOptions, SendResult };

export async function sendEmail(
  config: AppConfig,
  opts: Omit<SendOptions, 'source'>,
): Promise<SendResult> {
  return sendEmailShared(config, { ...opts, source: 'Phase9A.MagicLink' });
}
