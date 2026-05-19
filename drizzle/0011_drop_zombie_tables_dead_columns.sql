-- Launch-week schema cleanup. Wraps every drop in a single transaction so
-- partial-apply is impossible. One-way migration; rollback path is PITR
-- (docs/runbooks/supabase-pitr-drill.md).
--
-- Pre-migration controls (operator runs before applying):
--   SELECT count(*) FROM crisis_events;
--   SELECT count(*) FROM suppression_list;
--   SELECT count(*) FROM audit_log WHERE trigger_source = 'whatsapp';
--   -- The 'whatsapp' rows STAY — append-only audit history (CLAUDE.md
--   -- hard rule #3). Only the TS enum literal narrows; Postgres keeps
--   -- 'whatsapp' as a valid value.
--   git grep -nE 'phoneHash|phone_hash|commStyle|comm_style|responseDepth|response_depth|profileFlags|profile_flags|crisis_events|suppression_list' src/ web/ tests/
--   -- Expect zero live writers remaining (the launch-cleanup PR removes
--   -- them in the same diff as this migration).

BEGIN;

-- Zombie tables ---------------------------------------------------------------
DROP TABLE IF EXISTS "crisis_events" CASCADE;
DROP TABLE IF EXISTS "suppression_list" CASCADE;

-- users ----------------------------------------------------------------------
ALTER TABLE "users" DROP COLUMN IF EXISTS "phone_hash";
ALTER TABLE "users" DROP COLUMN IF EXISTS "phone_encrypted";
ALTER TABLE "users" DROP COLUMN IF EXISTS "last_completed_step";
ALTER TABLE "users" DROP COLUMN IF EXISTS "needs_profile_review";
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_hash";
ALTER TABLE "users" DROP COLUMN IF EXISTS "comm_style";
ALTER TABLE "users" DROP COLUMN IF EXISTS "response_depth";
ALTER TABLE "users" DROP COLUMN IF EXISTS "profile_flags";
ALTER TABLE "users" ALTER COLUMN "timezone" SET DEFAULT 'UTC';

-- turns ----------------------------------------------------------------------
-- All written by the pre-2026-05-13 multi-step pipeline (triage / tagger /
-- quality-check / dispatch). The streaming chat handler — the sole writer
-- today — stopped populating them in the same PR as this migration.
ALTER TABLE "turns" DROP COLUMN IF EXISTS "intent";
ALTER TABLE "turns" DROP COLUMN IF EXISTS "practice_tag";
ALTER TABLE "turns" DROP COLUMN IF EXISTS "level_tag";
ALTER TABLE "turns" DROP COLUMN IF EXISTS "secondary_practice_tag";
ALTER TABLE "turns" DROP COLUMN IF EXISTS "secondary_level_tag";
ALTER TABLE "turns" DROP COLUMN IF EXISTS "tagger_confidence";
ALTER TABLE "turns" DROP COLUMN IF EXISTS "response_mode";
ALTER TABLE "turns" DROP COLUMN IF EXISTS "fallback_path";
ALTER TABLE "turns" DROP COLUMN IF EXISTS "qa_outcome";
ALTER TABLE "turns" DROP COLUMN IF EXISTS "retry_count";
ALTER TABLE "turns" DROP COLUMN IF EXISTS "terminal_event";
ALTER TABLE "turns" DROP COLUMN IF EXISTS "delivery_receipt";
ALTER TABLE "turns" DROP COLUMN IF EXISTS "degradation_flags";

-- audit_log ------------------------------------------------------------------
-- Per CLAUDE.md hard rule #3, audit history is append-only. The 'whatsapp'
-- trigger_source enum value stays in Postgres; only the TS schema narrows.
-- phone_hash is no longer carried by the live writer (post-WhatsApp
-- retirement) — drop the column.
ALTER TABLE "audit_log" DROP COLUMN IF EXISTS "phone_hash";

-- Enums ----------------------------------------------------------------------
-- suppression_reason had only one consumer (suppression_list, dropped above).
DROP TYPE IF EXISTS "suppression_reason";

COMMIT;
