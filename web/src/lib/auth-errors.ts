// Map Supabase Auth errors to user-readable copy. The raw error messages
// from supabase-js are useful for debugging but read like server logs to
// an end user. Translate the common cases; fall back to the raw message.

import type { AuthError } from '@supabase/supabase-js';

interface SupabaseErrorLike {
  message: string;
  code?: string;
  status?: number;
}

export function humanizeAuthError(err: AuthError | Error | SupabaseErrorLike): string {
  const code = 'code' in err && typeof err.code === 'string' ? err.code : '';
  const msg = err.message ?? '';
  const lower = msg.toLowerCase();

  // Rate limit (Supabase free tier: ~3-4 emails / hour per address).
  if (code === 'over_email_send_rate_limit' || lower.includes('rate limit')) {
    return "We've sent you a lot of emails recently. Wait a few minutes and try again.";
  }

  // Login with shouldCreateUser:false on an unknown email.
  if (code === 'otp_disabled' || lower.includes('signups not allowed')) {
    return "We don't have an account for this email yet. Try signing up instead.";
  }

  // Expired or invalid magic link (handled in the URL-error banner, but
  // also covered here for completeness).
  if (code === 'otp_expired' || lower.includes('expired')) {
    return 'That link expired. Request a new one.';
  }

  // Signup with an email already in auth.users.
  if (lower.includes('already registered') || lower.includes('user already')) {
    return "That email's already with us. Want to sign in instead?";
  }

  // Password too weak / short.
  if (lower.includes('password') && (lower.includes('weak') || lower.includes('short'))) {
    return 'Pick a stronger password — at least 6 characters.';
  }

  // Email invalid.
  if (lower.includes('invalid email')) {
    return "That email doesn't look right.";
  }

  // Network / unknown - surface the raw message so we don't black-box it.
  return msg || 'Something went wrong. Please try again.';
}

/**
 * Read URL params for the case where Supabase redirects back with an error
 * (e.g. expired confirmation link). Both query and hash variants exist.
 */
export function readAuthErrorFromUrl(): { code: string; description: string } | null {
  if (typeof window === 'undefined') return null;
  const fromQuery = readErrorParams(new URLSearchParams(window.location.search));
  if (fromQuery) return fromQuery;
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  return readErrorParams(new URLSearchParams(hash));
}

function readErrorParams(p: URLSearchParams): { code: string; description: string } | null {
  const error = p.get('error');
  if (!error) return null;
  return {
    code: p.get('error_code') ?? error,
    description: (p.get('error_description') ?? '').replace(/\+/g, ' '),
  };
}
