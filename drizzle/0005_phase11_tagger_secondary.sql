-- Phase 11 R17 — widen the tagger's audit trail.
--
-- The audit found the tagger silently coerced low-confidence inputs to
-- a default ('integrity'), masking ambiguous turns from the QC review
-- queue. v2 surfaces:
--   * secondary_practice_tag / secondary_level_tag — runner-up if any
--   * tagger_confidence       — float in [0, 1]; turns < 0.6 → review queue
--
-- All three columns are NULLABLE. Existing rows are NOT backfilled — the
-- backfill is explicitly OUT of scope per the Phase 11 plan and will land
-- as a follow-up batch job.

ALTER TABLE "turns" ADD COLUMN "secondary_practice_tag" text;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "secondary_level_tag" text;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "tagger_confidence" text;
