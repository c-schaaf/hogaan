-- Customer-feedback PR4 — replace role with leadership experience band.
--
-- Customer reported "everyone is a leader" — the role-picker
-- (Student/Professional/Leader/CommunityLeader/Advocate) doesn't
-- discriminate. Add an experience_band column capturing one of
--   '<5'   (Less than 5 years)
--   '5-10' (5 to 10 years)
--   '10+'  (Over 10 years)
--
-- Schema is additive: role stays nullable for backwards compatibility.
-- Downstream prompt assembly prefers experience_band when present and
-- omits the role line. Existing rows are NOT backfilled.

ALTER TABLE "users" ADD COLUMN "experience_band" text;
