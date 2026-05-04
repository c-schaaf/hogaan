CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "vector";--> statement-breakpoint
CREATE TYPE "public"."access_code_status" AS ENUM('unredeemed', 'redeemed', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."library_name" AS ENUM('prompt_templates', 'voice_rules', 'cultural_framing', 'crisis_resources', 'scenarios');--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('opt_out', 'block', 'bounce', 'abuse');--> statement-breakpoint
CREATE TYPE "public"."trigger_source" AS ENUM('whatsapp', 'web_session', 'web_signup');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('provisional', 'onboarding_started', 'onboarding_dormant', 'onboarded', 'consent_declined', 'opted_out', 'blocked', 'onboarding_error');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_message_type" AS ENUM('free_form', 'template');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_priority" AS ENUM('Normal', 'High', 'Critical');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_status" AS ENUM('queued', 'dispatching', 'sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TABLE "sponsors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"primary_contact_email" text NOT NULL,
	"mission_summary" text,
	"billing_address" jsonb,
	"reporting_preferences" jsonb,
	"compliance_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cohorts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sponsor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"seat_count" integer NOT NULL,
	"redemption_window_start" timestamp with time zone NOT NULL,
	"redemption_window_end" timestamp with time zone NOT NULL,
	"seat_duration_days" integer NOT NULL,
	"target_geography" text NOT NULL,
	"target_user_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_hash" text NOT NULL,
	"phone_encrypted" text,
	"first_name_encrypted" text,
	"status" "user_status" DEFAULT 'provisional' NOT NULL,
	"last_completed_step" integer DEFAULT 0 NOT NULL,
	"needs_profile_review" boolean DEFAULT false NOT NULL,
	"goals" jsonb,
	"role" text,
	"location" text,
	"timezone" text DEFAULT 'Africa/Mogadishu',
	"is_diaspora" boolean DEFAULT false NOT NULL,
	"mapped_practices" jsonb,
	"profile_flags" jsonb,
	"cohort_id" uuid,
	"onboarding_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_hash_unique" UNIQUE("phone_hash")
);
--> statement-breakpoint
CREATE TABLE "access_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"cohort_id" uuid NOT NULL,
	"status" "access_code_status" DEFAULT 'unredeemed' NOT NULL,
	"redeemed_user_id" uuid,
	"redeemed_at" timestamp with time zone,
	"generation_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_turn_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"user_message" text NOT NULL,
	"response_text" text,
	"intent" text,
	"practice_tag" text,
	"level_tag" text,
	"response_mode" text,
	"model_used" text,
	"fallback_path" text,
	"qa_outcome" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"degradation_flags" jsonb,
	"library_versions" jsonb,
	"determinism_hash" text,
	"delivery_receipt" jsonb,
	"terminal_event" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"turn_id" uuid,
	"content" text NOT NULL,
	"metadata" jsonb,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"trigger_source" "trigger_source" NOT NULL,
	"phone_hash" text,
	"user_id" uuid,
	"target_end_event" text NOT NULL,
	"ip_address" text,
	"input_errors" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"correlation_id" text NOT NULL,
	"caller_process_id" text NOT NULL,
	"user_id" uuid,
	"direction" "whatsapp_direction" NOT NULL,
	"message_type" "whatsapp_message_type" NOT NULL,
	"template_name" text,
	"template_params" jsonb,
	"content_text" text,
	"priority" "whatsapp_priority" DEFAULT 'Normal' NOT NULL,
	"status" "whatsapp_status" DEFAULT 'queued' NOT NULL,
	"wa_message_id" text,
	"last_status_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"terminal_end_event" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_messages_correlation_id_unique" UNIQUE("correlation_id")
);
--> statement-breakpoint
CREATE TABLE "suppression_list" (
	"phone_hash" text PRIMARY KEY NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "library_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_name" "library_name" NOT NULL,
	"version" text NOT NULL,
	"payload" jsonb NOT NULL,
	"hash" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" text DEFAULT 'system' NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_sponsor_id_sponsors_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_cohort_id_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."cohorts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_cohort_id_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."cohorts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_redeemed_user_id_users_id_fk" FOREIGN KEY ("redeemed_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "library_versions_name_version_uq" ON "library_versions" USING btree ("library_name","version");--> statement-breakpoint
-- pgvector HNSW index for cosine similarity. Process #8 read path uses
-- 1 - (embedding <=> query) for cosine, sorted by distance ascending.
CREATE INDEX "memories_embedding_hnsw_idx" ON "memories" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
-- Append-only audit_log per Process #12 §8 + CLAUDE.md hard rule #4.
-- Triggers fire even for superuser, unlike GRANT/REVOKE which superuser bypasses.
CREATE OR REPLACE FUNCTION audit_log_no_modify() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; UPDATE and DELETE are not permitted';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_no_modify();--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_no_modify();--> statement-breakpoint
-- Belt-and-suspenders: revoke from PUBLIC so non-superuser app roles also blocked at GRANT layer.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM PUBLIC;