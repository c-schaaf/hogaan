-- 0023 — P3.1b "Sign in with Hogaan" for AI assistants (MCP OAuth).
--
-- mcp_oauth_grants: one row per assistant a leader connected by signing in
--   and approving. Access and refresh tokens are signed values that name
--   their grant; every use checks the grant here, so revoking the row ends
--   the connection. Stores hashes only (client id, refresh-token id).
--   code_jti is unique so an authorization code can be exchanged once.
--
-- Rollback (destructive): DROP TABLE mcp_oauth_grants;

CREATE TABLE IF NOT EXISTS "mcp_oauth_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "client_key" text NOT NULL,
  "client_name" text NOT NULL,
  "redirect_host" text NOT NULL,
  "scope" text NOT NULL,
  "code_jti" text NOT NULL,
  "refresh_jti_hash" text NOT NULL,
  "prev_refresh_jti_hash" text,
  "rotated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_oauth_grants_code_uq" ON "mcp_oauth_grants" ("code_jti");
CREATE INDEX IF NOT EXISTS "mcp_oauth_grants_user_idx" ON "mcp_oauth_grants" ("user_id");

ALTER TABLE "public"."mcp_oauth_grants" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mcp_oauth_grants_owner" ON "public"."mcp_oauth_grants";
CREATE POLICY "mcp_oauth_grants_owner" ON "public"."mcp_oauth_grants" FOR ALL
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
