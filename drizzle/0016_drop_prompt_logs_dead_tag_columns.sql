-- SCRUM — `prompt_logs.practice_tag` and `prompt_logs.level_tag` columns
-- have no writers on any live path (the tagger was stubbed in
-- `src/prompt-assembly/validate.ts:7-15` when the unified prompt landed).
-- They sit nullable forever and clutter every analytics view referencing
-- them. Drop them here; the `analytics.prompt_logs_safe` view that
-- references the columns is re-created in `0017` to keep BI consumers
-- working.
--
-- The companion code change drops the corresponding fields from
-- `src/shared/db/schema/prompt-logs.ts` and removes the inserts at
-- `src/prompt-assembly/log.ts:33-34`. Determinism-hash inputs are also
-- trimmed in the same PR (`DETERMINISM_HASH_VERSION` bumps to `'v3'`).

BEGIN;

-- Drop the dependent analytics view first; recreate it in 0017 without
-- the now-dropped columns. DROP VIEW IF EXISTS is idempotent.
DROP VIEW IF EXISTS "analytics"."prompt_logs_safe";

ALTER TABLE "public"."prompt_logs"
  DROP COLUMN IF EXISTS "practice_tag",
  DROP COLUMN IF EXISTS "level_tag";

COMMIT;
