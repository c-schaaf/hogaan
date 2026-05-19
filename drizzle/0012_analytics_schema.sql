-- Metabase-ready analytics layer. Creates a separate `analytics` schema
-- with PII-masked views and a read-only `metabase_reader` role bound to it.
-- Keeps BI access isolated from prod-table changes and out of the
-- application connection.
--
-- IMPORTANT — operator must rotate the placeholder password before
-- connecting Metabase. See docs/runbooks/metabase-setup.md.

BEGIN;

-- Schema ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS "analytics";

-- Role -----------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'metabase_reader') THEN
    CREATE ROLE "metabase_reader" LOGIN PASSWORD 'metabase_placeholder_rotate_me';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA "analytics" TO "metabase_reader";
ALTER DEFAULT PRIVILEGES IN SCHEMA "analytics"
  GRANT SELECT ON TABLES TO "metabase_reader";

-- Indexes (in public — analytics queries reach into the base tables
-- through the views, so the indexes live where the data lives). All
-- IF NOT EXISTS for idempotency.
CREATE INDEX IF NOT EXISTS "idx_users_created_at" ON "users" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_users_onboarding_completed_at"
  ON "users" ("onboarding_completed_at");
CREATE INDEX IF NOT EXISTS "idx_sessions_user_lastturn"
  ON "sessions" ("user_id", "last_turn_at");
CREATE INDEX IF NOT EXISTS "idx_turns_user_created"
  ON "turns" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_turns_created_at" ON "turns" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_prompt_logs_created_at" ON "prompt_logs" ("created_at");

-- Views — PII-masked --------------------------------------------------------
-- users_safe: no encrypted-name columns, no email plaintext beyond a verified
-- boolean.
CREATE OR REPLACE VIEW "analytics"."users_safe" AS
SELECT
  "id",
  "status",
  "created_at",
  "onboarding_completed_at",
  "experience_band",
  "role",
  "location",
  "timezone",
  "mapped_practices",
  ("email_verified_at" IS NOT NULL) AS "is_email_verified"
FROM "public"."users";

-- sessions_safe: title masked to a boolean — titles can echo user prose.
CREATE OR REPLACE VIEW "analytics"."sessions_safe" AS
SELECT
  "id",
  "user_id",
  "started_at",
  "last_turn_at",
  "closed_at",
  "turn_count",
  "is_private",
  ("title" IS NOT NULL) AS "has_title"
FROM "public"."sessions";

-- turns_safe: user_message + response_text omitted (plaintext PII).
-- Lengths are useful for engagement metrics without leaking content.
CREATE OR REPLACE VIEW "analytics"."turns_safe" AS
SELECT
  "id",
  "session_id",
  "user_id",
  "model_used",
  "latency_ms",
  "library_versions",
  "determinism_hash",
  "created_at",
  length("user_message") AS "user_message_length",
  length("response_text") AS "response_text_length"
FROM "public"."turns";

-- prompt_logs_safe: encrypted prompt body omitted.
CREATE OR REPLACE VIEW "analytics"."prompt_logs_safe" AS
SELECT
  "id",
  "user_id",
  "session_id",
  "turn_id",
  "response_mode",
  "practice_tag",
  "level_tag",
  "token_count",
  "library_versions",
  "determinism_hash",
  "created_at"
FROM "public"."prompt_logs";

-- Explicit GRANT on the four views — ALTER DEFAULT PRIVILEGES above only
-- covers tables CREATEd after this statement runs.
GRANT SELECT ON ALL TABLES IN SCHEMA "analytics" TO "metabase_reader";

COMMIT;
