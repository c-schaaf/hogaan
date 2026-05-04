CREATE TABLE "crisis_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"session_id" uuid,
	"turn_id" uuid,
	"trigger_source" text NOT NULL,
	"outcome_category" text NOT NULL,
	"resources_version" text NOT NULL,
	"dispatched_wa_message_id" text,
	"error_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crisis_events" ADD CONSTRAINT "crisis_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crisis_events" ADD CONSTRAINT "crisis_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crisis_events" ADD CONSTRAINT "crisis_events_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Index supports the §8 sponsor reporting query (crisis events by user over time).
CREATE INDEX "crisis_events_user_created_idx" ON "crisis_events" ("user_id", "created_at" DESC);--> statement-breakpoint
-- Per-trigger lookup for ops dashboards.
CREATE INDEX "crisis_events_trigger_source_idx" ON "crisis_events" ("trigger_source");
