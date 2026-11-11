-- Context-and-connections build, Phase 4 (P4.1–P4.3) — subscriptions.
--
-- subscriptions: one row per leader with a paid or sponsored plan. No row =
--   Free. Mirrors Stripe state received via signed webhooks; Stripe is the
--   source of truth for payment. No card data is ever stored here.
-- billing_events: Stripe event ids already processed (webhook idempotency).
--
-- Rollback (destructive): DROP TABLE billing_events, subscriptions;

CREATE TABLE IF NOT EXISTS "subscriptions" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "plan" text DEFAULT 'free' NOT NULL,
  "status" text DEFAULT 'inactive' NOT NULL,
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "current_period_end" timestamp with time zone,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "subscriptions_plan_chk" CHECK ("plan" IN ('free', 'personal'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_stripe_sub_uq" ON "subscriptions" ("stripe_subscription_id");
CREATE INDEX IF NOT EXISTS "subscriptions_stripe_customer_idx" ON "subscriptions" ("stripe_customer_id");

CREATE TABLE IF NOT EXISTS "billing_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subscriptions_owner" ON "public"."subscriptions";
CREATE POLICY "subscriptions_owner" ON "public"."subscriptions" FOR ALL
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));

ALTER TABLE "public"."billing_events" ENABLE ROW LEVEL SECURITY;
