-- Web-app port (Phase B) - end-user auth + persistence.
--
-- The WhatsApp backend identifies users by phone_hash. To stand up the web
-- channel without a separate users table we add email, password_hash, and
-- a few personalization columns to the existing users table. phone_hash
-- stays NOT NULL UNIQUE; web-only users get a synthetic value of the form
-- sha256('web:' || users.id) generated at insert time.
--
-- Communication style + response depth come from the typeform onboarding
-- (Screens 6 + 7). They influence prompt assembly but are nullable so
-- existing WhatsApp rows keep working.
--
-- sessions.title is a 3-7 word summary derived after the first turn so the
-- Sessions tab can show "Hiring decision for Nairobi office" instead of a
-- raw timestamp. sessions.is_private supports the chat private-mode toggle:
-- when true, turns for that session are not persisted (or are scrubbed at
-- session close - decided in Phase C).

ALTER TABLE "users" ADD COLUMN "email" text;
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamptz;
ALTER TABLE "users" ADD COLUMN "password_hash" text;
ALTER TABLE "users" ADD COLUMN "full_name_encrypted" text;
ALTER TABLE "users" ADD COLUMN "comm_style" text;
ALTER TABLE "users" ADD COLUMN "response_depth" text;

-- Case-insensitive unique index, only enforced when email is non-null so
-- existing WhatsApp users (email IS NULL) don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique"
  ON "users" (lower(email))
  WHERE email IS NOT NULL;

ALTER TABLE "sessions" ADD COLUMN "title" text;
ALTER TABLE "sessions" ADD COLUMN "is_private" boolean NOT NULL DEFAULT false;
