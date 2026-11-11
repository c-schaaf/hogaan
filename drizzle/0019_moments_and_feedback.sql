-- Context-and-connections build, Phase 2 (P2.1–P2.4, P2.6).
--
-- moments: upcoming conversations a leader is preparing for (what, with
--   whom BY ROLE, when). Text columns are AES-256-GCM ciphertext.
-- moment_outcomes: the leader's reflection after the moment (P2.3).
-- turn_ratings: helpful / not helpful per coach reply, pinned to the prompt
--   version and model so library versions can be compared (P2.4).
-- notification_prefs: explicit opt-ins for proactive email (D4: email only,
--   opt-in, max 2 a week, quiet hours by timezone).
-- email_sends: one row per proactive email attempt. Holds NO content — only
--   kind, status and the idempotency key (Hard Rule 5) used for the cap.
--
-- Rollback (destructive): DROP TABLE email_sends, notification_prefs,
--   turn_ratings, moment_outcomes, moments;

CREATE TABLE IF NOT EXISTS "moments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "session_id" uuid REFERENCES "sessions"("id") ON DELETE SET NULL,
  "what_encrypted" text NOT NULL,
  "with_whom_encrypted" text,
  "happens_at" timestamp with time zone,
  "status" text DEFAULT 'upcoming' NOT NULL,
  "source" text DEFAULT 'conversation' NOT NULL,
  "dedupe_hash" text NOT NULL,
  "followup_sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "moments_status_chk" CHECK ("status" IN ('upcoming', 'reflected', 'dismissed')),
  CONSTRAINT "moments_source_chk" CHECK ("source" IN ('conversation', 'leader', 'assistant'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "moments_user_dedupe_uq" ON "moments" ("user_id", "dedupe_hash");
CREATE INDEX IF NOT EXISTS "moments_user_happens_idx" ON "moments" ("user_id", "happens_at");

CREATE TABLE IF NOT EXISTS "moment_outcomes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "moment_id" uuid NOT NULL REFERENCES "moments"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "how_it_went" text NOT NULL,
  "differently_encrypted" text,
  "confidence_before" integer,
  "confidence_after" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "moment_outcomes_how_chk" CHECK ("how_it_went" IN ('well', 'mixed', 'hard')),
  CONSTRAINT "moment_outcomes_conf_chk" CHECK (
    ("confidence_before" IS NULL OR "confidence_before" BETWEEN 1 AND 5) AND
    ("confidence_after" IS NULL OR "confidence_after" BETWEEN 1 AND 5))
);
CREATE UNIQUE INDEX IF NOT EXISTS "moment_outcomes_moment_uq" ON "moment_outcomes" ("moment_id");

CREATE TABLE IF NOT EXISTS "turn_ratings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "turn_id" uuid NOT NULL REFERENCES "turns"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "rating" text NOT NULL,
  "note_encrypted" text,
  "prompt_version" text,
  "determinism_hash" text,
  "model_used" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "turn_ratings_rating_chk" CHECK ("rating" IN ('helpful', 'not_helpful'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "turn_ratings_turn_user_uq" ON "turn_ratings" ("turn_id", "user_id");

CREATE TABLE IF NOT EXISTS "notification_prefs" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "followup_email_opt_in" boolean DEFAULT false NOT NULL,
  "weekly_nudge_opt_in" boolean DEFAULT false NOT NULL,
  "unsubscribed_all_at" timestamp with time zone,
  "quiet_start_hour" integer DEFAULT 21 NOT NULL,
  "quiet_end_hour" integer DEFAULT 8 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "email_sends" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" text DEFAULT 'sending' NOT NULL,
  "provider_message_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "email_sends_status_chk" CHECK ("status" IN ('sending', 'sent', 'captured', 'failed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_sends_idem_uq" ON "email_sends" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "email_sends_user_created_idx" ON "email_sends" ("user_id", "created_at");

ALTER TABLE "public"."moments" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "moments_owner" ON "public"."moments";
CREATE POLICY "moments_owner" ON "public"."moments" FOR ALL
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));

ALTER TABLE "public"."moment_outcomes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "moment_outcomes_owner" ON "public"."moment_outcomes";
CREATE POLICY "moment_outcomes_owner" ON "public"."moment_outcomes" FOR ALL
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));

ALTER TABLE "public"."turn_ratings" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "turn_ratings_owner" ON "public"."turn_ratings";
CREATE POLICY "turn_ratings_owner" ON "public"."turn_ratings" FOR ALL
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));

ALTER TABLE "public"."notification_prefs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notification_prefs_owner" ON "public"."notification_prefs";
CREATE POLICY "notification_prefs_owner" ON "public"."notification_prefs" FOR ALL
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));

ALTER TABLE "public"."email_sends" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_sends_owner" ON "public"."email_sends";
CREATE POLICY "email_sends_owner" ON "public"."email_sends" FOR ALL
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
