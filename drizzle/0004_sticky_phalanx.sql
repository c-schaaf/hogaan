CREATE TYPE "public"."sponsor_user_role" AS ENUM('sponsor_admin', 'hogaan_ops');--> statement-breakpoint
CREATE TABLE "sponsor_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sponsor_id" uuid,
	"email" text NOT NULL,
	"role" "sponsor_user_role" NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sponsor_users" ADD CONSTRAINT "sponsor_users_sponsor_id_sponsors_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_users_email_unique" ON "sponsor_users" USING btree ("email");