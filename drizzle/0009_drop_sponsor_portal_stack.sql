-- SCRUM-41: drop the sponsor portal stack and the WhatsApp-era messages
-- table. The sponsor portal (Phase 9A) was never shipped; the WhatsApp
-- pipeline was retired pre-2026-05-13. Both leave dead schema behind.
--
-- One-way migration. Rollback path = PITR restore
-- (see docs/runbooks/supabase-pitr-drill.md).
--
-- Order matters: drop FK-dependent tables before their targets, and drop
-- enums after the tables that referenced them.

DROP TABLE IF EXISTS "access_codes" CASCADE;
ALTER TABLE "users" DROP COLUMN IF EXISTS "cohort_id";
DROP TABLE IF EXISTS "cohorts" CASCADE;
DROP TABLE IF EXISTS "sponsor_users" CASCADE;
DROP TABLE IF EXISTS "whatsapp_messages" CASCADE;
DROP TABLE IF EXISTS "sponsors" CASCADE;

DROP TYPE IF EXISTS "sponsor_user_role";
DROP TYPE IF EXISTS "access_code_status";
DROP TYPE IF EXISTS "whatsapp_direction";
DROP TYPE IF EXISTS "whatsapp_status";
DROP TYPE IF EXISTS "whatsapp_message_type";
DROP TYPE IF EXISTS "whatsapp_priority";
