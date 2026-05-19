-- SCRUM-49: drop users.is_diaspora and users.goals.
--
-- Both are unread after the SCRUM-43/47 prompt-assembly simplification and
-- the SCRUM-48 practice-selection rework. One-way migration; rollback via
-- PITR (docs/runbooks/supabase-pitr-drill.md). Pre-merge control: dump any
-- non-empty rows to a CSV archive before running this migration in prod.

ALTER TABLE "users" DROP COLUMN IF EXISTS "is_diaspora";
ALTER TABLE "users" DROP COLUMN IF EXISTS "goals";
