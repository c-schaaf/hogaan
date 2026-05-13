import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

/**
 * Create (or reset the password of) a demo Hogaan account directly in
 * Supabase's auth schema. Skips email confirmation so the user can sign
 * in immediately with email + password.
 *
 * v2 (2026-05-12) — fixes "Database error querying schema" by:
 *   - Setting all token columns (confirmation_token, recovery_token,
 *     email_change_token_*, phone_change_token, reauthentication_token)
 *     to empty string instead of NULL. GoTrue's login queries assume
 *     these are strings, not NULLs, in some versions.
 *   - Using provider_id = user_id (NOT email) on the identities row,
 *     which is what Supabase expects for the 'email' provider.
 *   - identity_data shape matches Supabase: { sub, email, email_verified,
 *     phone_verified }.
 *
 * Re-runnable: if the email exists it rotates the password.
 *
 * Run: pnpm tsx scripts/create-demo-account.ts
 */

const EMAIL = 'demo@hogaan.com';
const PASSWORD = 'Hamse2026!';
const FULL_NAME = 'Demo Hogaan';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL not set');
  const sql = postgres(url, { prepare: false, max: 2, idle_timeout: 5, connect_timeout: 10 });

  try {
    await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

    const existing = await sql<{ id: string }[]>`
      SELECT id FROM auth.users WHERE email = ${EMAIL} LIMIT 1
    `;

    let userId: string;
    if (existing[0] !== undefined) {
      userId = existing[0].id;
      console.log(`User exists — rotating password for ${EMAIL} (${userId}).`);
      await sql`
        UPDATE auth.users
        SET encrypted_password = crypt(${PASSWORD}, gen_salt('bf', 10)),
            email_confirmed_at = COALESCE(email_confirmed_at, now()),
            confirmation_token = '',
            recovery_token = '',
            email_change_token_new = '',
            email_change_token_current = '',
            email_change = '',
            phone_change_token = '',
            reauthentication_token = '',
            updated_at = now()
        WHERE id = ${userId}
      `;
    } else {
      userId = randomUUID();
      console.log(`Creating fresh ${EMAIL} (${userId}).`);
      await sql.begin(async (tx) => {
        // Setting every token column to '' (not NULL) is the key fix —
        // GoTrue's auth API queries WHERE confirmation_token = '' etc, and
        // those return no rows if the column is NULL.
        await tx`
          INSERT INTO auth.users (
            id, instance_id, aud, role,
            email, encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data,
            created_at, updated_at,
            confirmation_token, recovery_token,
            email_change_token_new, email_change_token_current,
            email_change, phone_change_token,
            reauthentication_token,
            is_super_admin, is_sso_user, is_anonymous,
            email_change_confirm_status
          ) VALUES (
            ${userId},
            '00000000-0000-0000-0000-000000000000',
            'authenticated',
            'authenticated',
            ${EMAIL},
            crypt(${PASSWORD}, gen_salt('bf', 10)),
            now(),
            ${'{"provider":"email","providers":["email"]}'}::jsonb,
            ${JSON.stringify({ full_name: FULL_NAME })}::jsonb,
            now(),
            now(),
            '', '', '', '', '', '', '',
            false, false, false,
            0
          )
        `;
        await tx`
          INSERT INTO auth.identities (
            id, user_id, identity_data, provider, provider_id,
            last_sign_in_at, created_at, updated_at
          ) VALUES (
            ${randomUUID()},
            ${userId},
            ${JSON.stringify({
              sub: userId,
              email: EMAIL,
              email_verified: true,
              phone_verified: false,
            })}::jsonb,
            'email',
            ${userId},
            now(),
            now(),
            now()
          )
        `;
      });
    }

    console.log('\n=========================================');
    console.log('Demo account ready:');
    console.log(`  Email:    ${EMAIL}`);
    console.log(`  Password: ${PASSWORD}`);
    console.log(`  user_id:  ${userId}`);
    console.log('=========================================\n');
    console.log('Sign in at http://localhost:3000 → "Sign in" link.');
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('create-demo-account failed:', err);
  process.exit(1);
});
