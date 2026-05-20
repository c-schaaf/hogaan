-- SCRUM — Row Level Security baseline.
--
-- Enables RLS on every per-user table. The app connection role
-- (the role used by postgres.js in `src/shared/db/client.ts`) is granted
-- BYPASSRLS so today's handlers keep working unchanged. The policies
-- below are the ground for tightening in a future PR — they intentionally
-- match the app's ownership predicates so removal of a code-level check
-- still fails closed for any future per-user connection role.
--
-- See CLAUDE.md "Hard Rules" addendum noting that ownership predicates in
-- app code remain the load-bearing tenant-isolation control. A future PR
-- will tighten policies once we adopt a per-user connection role (e.g. the
-- Supabase Auth `auth.uid()` pattern) or wrap every handler in an explicit
-- transaction with `SET LOCAL app.user_id = '...'`.

BEGIN;

-- App role bypass. Idempotent — only flips if not already set.
DO $$
DECLARE
  app_role text := current_user;
BEGIN
  EXECUTE format('ALTER ROLE %I BYPASSRLS', app_role);
END
$$;

-- users ---------------------------------------------------------------
ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_self_select" ON "public"."users";
DROP POLICY IF EXISTS "users_self_modify" ON "public"."users";
CREATE POLICY "users_self_select" ON "public"."users"
  FOR SELECT
  USING (id::text = current_setting('app.user_id', true));
CREATE POLICY "users_self_modify" ON "public"."users"
  FOR ALL
  USING (id::text = current_setting('app.user_id', true))
  WITH CHECK (id::text = current_setting('app.user_id', true));

-- sessions ------------------------------------------------------------
ALTER TABLE "public"."sessions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sessions_owner" ON "public"."sessions";
CREATE POLICY "sessions_owner" ON "public"."sessions"
  FOR ALL
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));

-- turns ---------------------------------------------------------------
ALTER TABLE "public"."turns" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "turns_owner" ON "public"."turns";
CREATE POLICY "turns_owner" ON "public"."turns"
  FOR ALL
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));

-- memories ------------------------------------------------------------
ALTER TABLE "public"."memories" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "memories_owner" ON "public"."memories";
CREATE POLICY "memories_owner" ON "public"."memories"
  FOR ALL
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));

-- audit_log: append-only by the app, no per-user policy required today.
-- prompt_logs: aggregate logs, no per-user policy required today.

COMMIT;
