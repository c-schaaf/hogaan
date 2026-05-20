-- SCRUM — `GET /api/sessions/:id` orders turns by `created_at` within a
-- session (`src/web-api/routes.ts` GET session handler). Without this
-- composite index, the planner falls back to the `session_id`-only index
-- + sort, which pays for itself at ~50+ turns per session. Index is small
-- (~tens of bytes per turn) and write-cost is negligible.
--
-- `IF NOT EXISTS` for idempotency. Use `CREATE INDEX CONCURRENTLY`
-- variant out-of-band on prod if the `turns` table is large enough that
-- a blocking build is a concern.

BEGIN;

CREATE INDEX IF NOT EXISTS "idx_turns_session_created"
  ON "public"."turns" ("session_id", "created_at");

COMMIT;
