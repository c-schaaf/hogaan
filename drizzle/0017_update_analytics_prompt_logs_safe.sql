-- SCRUM — re-create `analytics.prompt_logs_safe` without the dropped
-- `practice_tag` / `level_tag` columns. Matches `0016`. Keeps the
-- previously-granted SELECT for `metabase_reader`.

BEGIN;

CREATE OR REPLACE VIEW "analytics"."prompt_logs_safe" AS
SELECT
  "id",
  "user_id",
  "session_id",
  "turn_id",
  "response_mode",
  "token_count",
  "library_versions",
  "determinism_hash",
  "created_at"
FROM "public"."prompt_logs";

GRANT SELECT ON "analytics"."prompt_logs_safe" TO "metabase_reader";

COMMIT;
