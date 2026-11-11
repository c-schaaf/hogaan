-- Context-and-connections build, Phase 3 (P3.1, P3.4) — Hogaan MCP server.
--
-- mcp_tokens: personal access tokens a leader creates in the app to connect
--   their own AI assistant. Only the SHA-256 of the token is stored; the
--   token itself is shown once. Revocable.
-- trigger_source 'mcp': every MCP tool call writes an audit_log row.
--
-- Rollback (destructive): DROP TABLE mcp_tokens; (enum value stays).

ALTER TYPE "public"."trigger_source" ADD VALUE IF NOT EXISTS 'mcp';

CREATE TABLE IF NOT EXISTS "mcp_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "label" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_tokens_hash_uq" ON "mcp_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "mcp_tokens_user_idx" ON "mcp_tokens" ("user_id");

ALTER TABLE "public"."mcp_tokens" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mcp_tokens_owner" ON "public"."mcp_tokens";
CREATE POLICY "mcp_tokens_owner" ON "public"."mcp_tokens" FOR ALL
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
