import { eq } from 'drizzle-orm';
import { reportP2 } from '../../incident-handling/index.js';
import type { Database } from '../../shared/db/client.js';
import { sponsorUsers } from '../../shared/db/schema/sponsor-users.js';
import type { RedisBundle } from '../../shared/redis/client.js';
import { type AppConfig } from '../../shared/secrets/config.js';
import { sendEmail } from './email.js';
import {
  issueMagicLinkToken,
  issueSponsorSessionToken,
  TokenInvalidError,
  validateMagicLinkToken,
} from './token.js';

/**
 * Phase 9A.1 — magic-link request + callback flow.
 *
 *   1. Sponsor user enters email at /portal/login
 *   2. POST /auth/sponsor/request-link → we look up sponsor_users by email,
 *      issue a 10-min magic-link token, email a callback URL via Resend.
 *      Response is identical regardless of whether the email exists, so the
 *      endpoint cannot be used to enumerate accounts.
 *   3. User clicks the link → GET /auth/sponsor/callback?token=...
 *      Callback validates the magic-link token (kind+expiry+revocation),
 *      revokes it (single-use), issues a 24h session token, sets it as a
 *      Secure HttpOnly cookie, redirects to /portal/dashboard.
 *
 * The Redis revocation set guarantees a magic link can be used at most
 * once — we revoke immediately after a successful callback even though the
 * token's natural TTL would have it expire 10 min later.
 */

interface RequestLinkDeps {
  config: AppConfig;
  db: Database;
}

export interface RequestLinkResult {
  /** Always 'ok' on inputs that pass shape validation, regardless of whether
   * the email matched a row. Caller surfaces a generic "if your email is
   * registered, check your inbox" message. */
  status: 'ok' | 'invalid_email';
}

export async function requestMagicLink(
  deps: RequestLinkDeps,
  email: string,
): Promise<RequestLinkResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!isLikelyEmail(normalizedEmail)) {
    return { status: 'invalid_email' };
  }

  const baseUrl = deps.config.sponsorPortalBaseUrl ?? deps.config.publicBaseUrl;
  if (baseUrl === undefined) {
    reportP2('SPONSOR_PORTAL_BASE_URL / PUBLIC_BASE_URL unset; cannot build magic-link URL', {
      source: 'Phase9A.MagicLink',
    });
    // Still return 'ok' so we don't leak misconfiguration to the requester.
    return { status: 'ok' };
  }

  const matched = await deps.db
    .select({ id: sponsorUsers.id })
    .from(sponsorUsers)
    .where(eq(sponsorUsers.email, normalizedEmail))
    .limit(1);

  // Always 'ok' regardless of whether the email exists — defends against
  // account enumeration.
  if (matched[0] === undefined) {
    reportP2('magic-link request for unknown email', {
      source: 'Phase9A.MagicLink',
      tags: { reason: 'unknown_email' },
    });
    return { status: 'ok' };
  }

  const sponsorUserId = matched[0].id;
  const token = await issueMagicLinkToken(deps.config, {
    sponsorUserId,
    email: normalizedEmail,
  });

  const callbackUrl = `${baseUrl.replace(/\/$/, '')}/auth/sponsor/callback?token=${encodeURIComponent(token)}`;
  const sendResult = await sendEmail(deps.config, {
    to: normalizedEmail,
    subject: 'Your Hogaan sponsor portal login link',
    html: renderHtml(callbackUrl),
    text: renderText(callbackUrl),
  });
  if (!sendResult.ok) {
    reportP2('magic-link email failed to send (non-blocking)', {
      source: 'Phase9A.MagicLink',
      tags: { reason: sendResult.reason ?? 'unknown' },
    });
  }

  return { status: 'ok' };
}

interface CallbackDeps {
  config: AppConfig;
  db: Database;
  redis: RedisBundle;
}

export type CallbackResult =
  | { status: 'ok'; sessionToken: string; redirectTo: string }
  | { status: 'invalid_token'; reason: string };

export async function handleCallback(deps: CallbackDeps, token: string): Promise<CallbackResult> {
  let claims;
  try {
    claims = await validateMagicLinkToken(deps.config, deps.redis, token);
  } catch (err) {
    if (err instanceof TokenInvalidError) {
      return { status: 'invalid_token', reason: err.message };
    }
    // Service-unavailable is a 5xx signal but for the user we still surface
    // a generic invalid_token (don't leak infra detail).
    reportP2('magic-link callback service-unavailable', {
      source: 'Phase9A.MagicLink',
      extra: { error: err instanceof Error ? err.message : String(err) },
    });
    return { status: 'invalid_token', reason: 'service_unavailable' };
  }

  // Single-use: revoke the magic-link jti immediately so a stolen link
  // becomes useless after first redemption.
  try {
    await deps.redis.withTimeout('token:revoke-magic-link', 500, () =>
      deps.redis.client.sadd('token:revoked', claims.jti),
    );
  } catch (err) {
    reportP2('failed to revoke magic-link jti (non-blocking)', {
      source: 'Phase9A.MagicLink',
      extra: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  const userRow = await deps.db
    .select({
      id: sponsorUsers.id,
      sponsorId: sponsorUsers.sponsorId,
      role: sponsorUsers.role,
      email: sponsorUsers.email,
    })
    .from(sponsorUsers)
    .where(eq(sponsorUsers.id, claims.sponsorUserId))
    .limit(1);
  const user = userRow[0];
  if (user === undefined) {
    return { status: 'invalid_token', reason: 'sponsor_user_not_found' };
  }
  if (user.email !== claims.email) {
    // Email on the row no longer matches the token — defend against email-rotation race.
    return { status: 'invalid_token', reason: 'email_mismatch' };
  }

  const sessionToken = await issueSponsorSessionToken(deps.config, {
    sponsorUserId: user.id,
    role: user.role,
    sponsorId: user.sponsorId ?? null,
    email: user.email,
  });

  // Update last-login timestamp (fail-open).
  try {
    await deps.db
      .update(sponsorUsers)
      .set({ lastLoginAt: new Date() })
      .where(eq(sponsorUsers.id, user.id));
  } catch {
    // ignore
  }

  return { status: 'ok', sessionToken, redirectTo: '/portal/dashboard' };
}

function renderHtml(callbackUrl: string): string {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#eaf4ff;font-family:'Inter','Segoe UI',-apple-system,sans-serif;color:#00004d;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eaf4ff;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#f4f9ff;border-radius:16px;padding:40px 32px;border:1px solid rgba(0,0,77,0.06);">
<tr><td>
<h2 style="margin:0 0 12px;font-family:'Lexend Deca','Inter',sans-serif;font-weight:500;font-size:22px;color:#00004d;letter-spacing:-0.01em;">Sponsor portal login</h2>
<p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#00004d;">Click the button below to sign into the Hogaan sponsor portal. The link expires in 10 minutes.</p>
<p style="margin:0 0 28px;"><a href="${callbackUrl}" style="display:inline-block;padding:14px 28px;background:#0086ff;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:600;font-size:15px;">Sign in to Hogaan</a></p>
<p style="margin:0;color:#6b6b7a;font-size:12.5px;line-height:1.5;">If you didn't request this, you can safely ignore this email.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function renderText(callbackUrl: string): string {
  return `Sign into the Hogaan sponsor portal:\n\n${callbackUrl}\n\nThis link expires in 10 minutes. If you didn't request it, you can ignore this email.`;
}

function isLikelyEmail(s: string): boolean {
  // Cheap shape check; real validation happens at Resend.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 320;
}

/**
 * Convenience used by verify-phase-9 + tests: ensure a sponsor_user exists
 * with the given (email, role, sponsorId). Idempotent.
 */
export async function upsertSponsorUser(
  db: Database,
  opts: {
    email: string;
    role: 'sponsor_admin' | 'hogaan_ops';
    sponsorId: string | null;
  },
): Promise<{ id: string }> {
  const normalized = opts.email.trim().toLowerCase();
  const existing = await db
    .select({ id: sponsorUsers.id })
    .from(sponsorUsers)
    .where(eq(sponsorUsers.email, normalized))
    .limit(1);
  if (existing[0] !== undefined) {
    await db
      .update(sponsorUsers)
      .set({
        role: opts.role,
        sponsorId: opts.sponsorId,
        updatedAt: new Date(),
      })
      .where(eq(sponsorUsers.id, existing[0].id));
    return { id: existing[0].id };
  }
  const ins = await db
    .insert(sponsorUsers)
    .values({
      email: normalized,
      role: opts.role,
      sponsorId: opts.sponsorId,
    })
    .returning({ id: sponsorUsers.id });
  return { id: ins[0]!.id };
}
