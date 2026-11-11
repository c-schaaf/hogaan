-- Context-and-connections build, Phase 5 (P5.1–P5.3).
--
-- New design (NOT a restore of the sponsor tables dropped in 0009):
--   organizations      a funder / employer / program that sponsors seats
--   org_admins         people who may see that organization's AGGREGATE report
--   cohorts            a group of seats with a size limit and dates
--   cohort_invites     invite codes (stored as SHA-256 only)
--   cohort_members     a leader holding a seat (sponsored plan while active)
--
-- Layer 4 — the metric glossary. Each metric is defined ONCE as a view in
-- the existing PII-masked `analytics` schema, so the in-app report, the CSV
-- export, Metabase and any agent all use the same number:
--   analytics.metric_coaching_sessions   coaching session = non-private session with >= 1 turn
--   analytics.metric_active_leaders      active leader = >= 1 coaching session in the ISO week
--   analytics.metric_moments_prepared    moment prepared = a moment not dismissed
--   analytics.metric_loops_closed        loop closed = moment prepared AND reflected on
--   analytics.metric_outcomes            self-reported outcome (well / mixed / hard)
--   analytics.metric_practice_coverage   practices a leader has in focus
--   analytics.metric_confidence_change   after - before (1–5 self-ratings), where both given
--   analytics.metric_rating_by_prompt_version  helpful share per prompt version + model (P2.4)
--
-- D5 privacy floor, enforced IN THE DATABASE: analytics.cohort_report only
-- returns a row for a cohort of a VERIFIED organization with at least 10
-- enrolled leaders (not counting the sponsor's own admins) of whom at least
-- 10 have used Hogaan since joining. Counts only — never ids, names, or
-- message content. Residual risk (build report): a verified sponsor who
-- creates 9+ real, active fake accounts could still isolate one leader;
-- vetting sponsors is the control for that.
--
-- Rollback (destructive): DROP VIEW analytics.cohort_report, analytics.metric_*;
--   DROP TABLE cohort_members, cohort_invites, cohorts, org_admins, organizations;

CREATE TABLE IF NOT EXISTS "organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "kind" text DEFAULT 'funder' NOT NULL,
  -- Set by Hogaan staff after vetting the sponsor (and, in production, its
  -- payment). Until then the org's cohorts grant no sponsored seats and
  -- produce no report.
  "verified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "organizations_kind_chk" CHECK ("kind" IN ('funder', 'employer', 'program'))
);

CREATE TABLE IF NOT EXISTS "org_admins" (
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("org_id", "user_id")
);

CREATE TABLE IF NOT EXISTS "cohorts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "seat_limit" integer NOT NULL,
  "starts_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ends_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cohorts_seat_limit_chk" CHECK ("seat_limit" BETWEEN 1 AND 10000)
);

CREATE TABLE IF NOT EXISTS "cohort_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cohort_id" uuid NOT NULL REFERENCES "cohorts"("id") ON DELETE CASCADE,
  "code_hash" text NOT NULL,
  "expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "cohort_invites_code_uq" ON "cohort_invites" ("code_hash");

CREATE TABLE IF NOT EXISTS "cohort_members" (
  "cohort_id" uuid NOT NULL REFERENCES "cohorts"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "left_at" timestamp with time zone,
  PRIMARY KEY ("cohort_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "cohort_members_user_idx" ON "cohort_members" ("user_id");

ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."org_admins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."cohorts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."cohort_invites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."cohort_members" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cohort_members_self" ON "public"."cohort_members";
CREATE POLICY "cohort_members_self" ON "public"."cohort_members" FOR ALL
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));

-- ---- Layer 4: metric glossary --------------------------------------------

CREATE OR REPLACE VIEW "analytics"."metric_coaching_sessions" AS
SELECT s."id" AS "session_id", s."user_id", s."started_at"
FROM "public"."sessions" s
WHERE s."is_private" = false AND s."turn_count" > 0;

CREATE OR REPLACE VIEW "analytics"."metric_active_leaders" AS
SELECT DISTINCT cs."user_id", date_trunc('week', cs."started_at") AS "week_start"
FROM "analytics"."metric_coaching_sessions" cs;

CREATE OR REPLACE VIEW "analytics"."metric_moments_prepared" AS
SELECT m."id" AS "moment_id", m."user_id", m."created_at", m."happens_at"
FROM "public"."moments" m
WHERE m."status" <> 'dismissed';

CREATE OR REPLACE VIEW "analytics"."metric_loops_closed" AS
SELECT mp."moment_id", mp."user_id", o."created_at" AS "closed_at"
FROM "analytics"."metric_moments_prepared" mp
JOIN "public"."moment_outcomes" o ON o."moment_id" = mp."moment_id";

CREATE OR REPLACE VIEW "analytics"."metric_outcomes" AS
SELECT o."user_id", o."how_it_went", o."created_at"
FROM "public"."moment_outcomes" o;

CREATE OR REPLACE VIEW "analytics"."metric_practice_coverage" AS
SELECT u."id" AS "user_id", p.value AS "practice"
FROM "public"."users" u
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(u."mapped_practices") = 'array' THEN u."mapped_practices" ELSE '[]'::jsonb END
) AS p(value);

CREATE OR REPLACE VIEW "analytics"."metric_confidence_change" AS
SELECT o."user_id", o."confidence_after" - o."confidence_before" AS "delta", o."created_at"
FROM "public"."moment_outcomes" o
WHERE o."confidence_before" IS NOT NULL AND o."confidence_after" IS NOT NULL;

CREATE OR REPLACE VIEW "analytics"."metric_rating_by_prompt_version" AS
SELECT
  r."prompt_version",
  r."model_used",
  count(*) AS "ratings",
  count(*) FILTER (WHERE r."rating" = 'helpful') AS "helpful",
  round(100.0 * count(*) FILTER (WHERE r."rating" = 'helpful') / count(*), 1) AS "helpful_pct"
FROM "public"."turn_ratings" r
GROUP BY r."prompt_version", r."model_used";

-- ---- P5.3 funder report, D5 floor enforced here ---------------------------
-- Members count while they hold the seat; activity counts from their join
-- date. Every column is an aggregate. Cohorts under 10 enrolled: no row.
CREATE OR REPLACE VIEW "analytics"."cohort_report" AS
WITH members AS (
  -- Active members, never the cohort's own sponsor admins.
  SELECT cm."cohort_id", cm."user_id", cm."joined_at"
  FROM "public"."cohort_members" cm
  JOIN "public"."cohorts" c2 ON c2."id" = cm."cohort_id"
  WHERE cm."left_at" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "public"."org_admins" oa
                    WHERE oa."org_id" = c2."org_id" AND oa."user_id" = cm."user_id")
),
enrolled AS (
  SELECT "cohort_id", count(*) AS "n" FROM members GROUP BY "cohort_id"
),
-- The floor counts leaders who have actually used Hogaan since joining, so
-- empty placeholder accounts cannot make a small group look big.
engaged AS (
  SELECT m."cohort_id", count(DISTINCT m."user_id") AS "n"
  FROM members m
  JOIN "analytics"."metric_coaching_sessions" cs
    ON cs."user_id" = m."user_id" AND cs."started_at" >= m."joined_at"
  GROUP BY m."cohort_id"
)
SELECT
  c."id" AS "cohort_id",
  c."org_id",
  e."n" AS "enrolled",
  c."seat_limit",
  (SELECT count(DISTINCT al."user_id") FROM members m
     JOIN "analytics"."metric_active_leaders" al ON al."user_id" = m."user_id"
     WHERE m."cohort_id" = c."id" AND al."week_start" >= date_trunc('week', now()) - interval '4 weeks'
       AND al."week_start" >= date_trunc('week', m."joined_at")) AS "active_last_4_weeks",
  (SELECT count(*) FROM members m
     JOIN "analytics"."metric_coaching_sessions" cs ON cs."user_id" = m."user_id" AND cs."started_at" >= m."joined_at"
     WHERE m."cohort_id" = c."id") AS "coaching_sessions",
  (SELECT count(*) FROM members m
     JOIN "analytics"."metric_moments_prepared" mp ON mp."user_id" = m."user_id" AND mp."created_at" >= m."joined_at"
     WHERE m."cohort_id" = c."id") AS "moments_prepared",
  (SELECT count(*) FROM members m
     JOIN "analytics"."metric_loops_closed" lc ON lc."user_id" = m."user_id" AND lc."closed_at" >= m."joined_at"
     WHERE m."cohort_id" = c."id") AS "loops_closed",
  (SELECT count(*) FROM members m
     JOIN "analytics"."metric_outcomes" oc ON oc."user_id" = m."user_id" AND oc."created_at" >= m."joined_at"
     WHERE m."cohort_id" = c."id" AND oc."how_it_went" = 'well') AS "outcomes_well",
  (SELECT count(*) FROM members m
     JOIN "analytics"."metric_outcomes" oc ON oc."user_id" = m."user_id" AND oc."created_at" >= m."joined_at"
     WHERE m."cohort_id" = c."id" AND oc."how_it_went" = 'mixed') AS "outcomes_mixed",
  (SELECT count(*) FROM members m
     JOIN "analytics"."metric_outcomes" oc ON oc."user_id" = m."user_id" AND oc."created_at" >= m."joined_at"
     WHERE m."cohort_id" = c."id" AND oc."how_it_went" = 'hard') AS "outcomes_hard",
  (SELECT round(avg(cc."delta")::numeric, 2) FROM members m
     JOIN "analytics"."metric_confidence_change" cc ON cc."user_id" = m."user_id" AND cc."created_at" >= m."joined_at"
     WHERE m."cohort_id" = c."id") AS "avg_confidence_change",
  (SELECT coalesce(jsonb_object_agg(x."practice", x."leaders"), '{}'::jsonb) FROM (
     SELECT pc."practice", count(*) AS "leaders" FROM members m
     JOIN "analytics"."metric_practice_coverage" pc ON pc."user_id" = m."user_id"
     WHERE m."cohort_id" = c."id" GROUP BY pc."practice") x) AS "practice_coverage"
FROM "public"."cohorts" c
JOIN "public"."organizations" o ON o."id" = c."org_id"
JOIN enrolled e ON e."cohort_id" = c."id"
JOIN engaged g ON g."cohort_id" = c."id"
WHERE o."verified_at" IS NOT NULL AND e."n" >= 10 AND g."n" >= 10;
