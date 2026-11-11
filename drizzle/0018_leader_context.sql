-- Context-and-connections build, Phase 1 (P1.1–P1.4) + P2.5 job table.
--
-- leader_briefs: one row per leader. Three short living documents
-- (profile / goals / notes) plus structured work-context fields (P1.2).
-- Every text column is AES-256-GCM ciphertext produced by
-- src/shared/db/encryption.ts — the database never sees plaintext.
--
-- background_jobs: durable, idempotent job queue for work that must never
-- run inside the chat turn (Hard Rule 1). dedupe_key makes enqueue
-- idempotent.
--
-- knowledge_digest: new library type for the founder-approved framework
-- digest (P1.4). Content is Hamse-owned; only the mechanism ships here.
--
-- Rollback (destructive — drops leader data):
--   DROP TABLE "leader_briefs"; DROP TABLE "background_jobs";
--   (enum values cannot be dropped in Postgres; 'knowledge_digest' stays.)

ALTER TYPE "public"."library_name" ADD VALUE IF NOT EXISTS 'knowledge_digest';

CREATE TABLE IF NOT EXISTS "leader_briefs" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "profile_fields_encrypted" text,
  "profile_encrypted" text,
  "goals_encrypted" text,
  "notes_encrypted" text,
  "version" integer DEFAULT 0 NOT NULL,
  "last_session_id" uuid REFERENCES "sessions"("id") ON DELETE SET NULL,
  "updated_by" text DEFAULT 'system' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "background_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "run_after" timestamp with time zone DEFAULT now() NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  CONSTRAINT "background_jobs_status_chk" CHECK ("status" IN ('pending', 'running', 'done', 'failed', 'cancelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "background_jobs_dedupe_uq" ON "background_jobs" ("dedupe_key");
CREATE INDEX IF NOT EXISTS "background_jobs_due_idx" ON "background_jobs" ("status", "run_after");

ALTER TABLE "public"."leader_briefs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leader_briefs_owner" ON "public"."leader_briefs";
CREATE POLICY "leader_briefs_owner" ON "public"."leader_briefs"
  FOR ALL
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));

-- background_jobs holds no per-user rows a reader should see: RLS on, no policy
-- (only the BYPASSRLS app role can touch it).
ALTER TABLE "public"."background_jobs" ENABLE ROW LEVEL SECURITY;
