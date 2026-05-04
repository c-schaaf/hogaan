CREATE TABLE "prompt_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"session_id" uuid,
	"turn_id" uuid,
	"response_mode" text NOT NULL,
	"practice_tag" text,
	"level_tag" text,
	"prompt_text_encrypted" text NOT NULL,
	"token_count" integer NOT NULL,
	"degradation_flags" jsonb NOT NULL,
	"library_versions" jsonb NOT NULL,
	"determinism_hash" text NOT NULL,
	"log_write_retried" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prompt_logs" ADD CONSTRAINT "prompt_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_logs" ADD CONSTRAINT "prompt_logs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_logs" ADD CONSTRAINT "prompt_logs_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Index on determinism_hash supports the Phase 7.15 voice-fidelity audit
-- harness ("find every prompt structurally identical to this one").
CREATE INDEX "prompt_logs_determinism_hash_idx" ON "prompt_logs" ("determinism_hash");--> statement-breakpoint
-- Composite index for replay-by-user-and-time queries.
CREATE INDEX "prompt_logs_user_created_idx" ON "prompt_logs" ("user_id", "created_at" DESC);