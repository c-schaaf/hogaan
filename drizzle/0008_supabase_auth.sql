-- Phase B-bis: switch end-user web auth from custom magic-link to Supabase Auth.
--
-- Adds users.supabase_user_id linking our public.users row to the Supabase
-- auth.users record. Nullable because WhatsApp users (phone_hash only) and
-- the old custom-magic-link rows don't have one. Unique-when-not-null via
-- a partial index so we don't collide.
--
-- We don't drop the old auth columns (email, password_hash,
-- email_verified_at, full_name_encrypted). Email is still useful as a
-- denormalized lookup; the rest are kept for the brief transition window
-- and can be cleaned up in a follow-up once no rows reference them.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "supabase_user_id" uuid;

CREATE UNIQUE INDEX IF NOT EXISTS "users_supabase_user_id_unique"
  ON "users" ("supabase_user_id")
  WHERE "supabase_user_id" IS NOT NULL;
