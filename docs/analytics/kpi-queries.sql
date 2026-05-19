-- ===========================================================================
-- Hogaan growth KPI pack — Metabase Questions for the Friday CGO demo
-- ===========================================================================
-- Connection role: metabase_reader  (see docs/runbooks/metabase-setup.md)
-- Target schema:   analytics.*  (NEVER public.*)
--
-- How to use:
--   1. In Metabase → Ask a question → SQL editor → New Question.
--   2. Pick the analytics database (metabase_reader-scoped).
--   3. Paste ONE labelled block below and Save.
--   4. Repeat for each block. The header line is a good Question title.
--
-- Each block is self-contained (no CTEs that span queries) and returns
-- columns named cleanly so Metabase auto-labels chart axes.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. daily_signups_last_30_days
-- Answers: How many new users signed up each day, last 30 days?
-- Chart: Line.
-- ---------------------------------------------------------------------------
SELECT
  date_trunc('day', created_at)::date AS day,
  count(*)                            AS signups
FROM analytics.users_safe
WHERE created_at >= now() - interval '30 days'
GROUP BY 1
ORDER BY 1;


-- ---------------------------------------------------------------------------
-- 2. activation_funnel
-- Answers: Of total signups, how many onboarded? How many sent ≥ 1 turn?
-- Chart: Funnel (or stacked bar).
-- ---------------------------------------------------------------------------
SELECT
  'signups'                  AS stage,
  count(*)                   AS users,
  1.0                        AS pct
FROM analytics.users_safe
UNION ALL
SELECT
  'onboarded',
  count(*),
  count(*)::float / NULLIF((SELECT count(*) FROM analytics.users_safe), 0)
FROM analytics.users_safe
WHERE onboarding_completed_at IS NOT NULL
UNION ALL
SELECT
  'sent_first_turn',
  count(DISTINCT user_id),
  count(DISTINCT user_id)::float / NULLIF((SELECT count(*) FROM analytics.users_safe), 0)
FROM analytics.turns_safe;


-- ---------------------------------------------------------------------------
-- 3. turns_per_user_distribution
-- Answers: How concentrated is engagement? Histogram of turn counts per user.
-- Chart: Bar (categorical x = bucket).
-- ---------------------------------------------------------------------------
SELECT
  CASE
    WHEN turn_count = 0           THEN '0'
    WHEN turn_count BETWEEN 1 AND 5   THEN '1-5'
    WHEN turn_count BETWEEN 6 AND 20  THEN '6-20'
    WHEN turn_count BETWEEN 21 AND 50 THEN '21-50'
    ELSE                                '50+'
  END         AS bucket,
  count(*)    AS users
FROM (
  SELECT u.id, COALESCE(count(t.id), 0) AS turn_count
  FROM analytics.users_safe u
  LEFT JOIN analytics.turns_safe t ON t.user_id = u.id
  GROUP BY u.id
) per_user
GROUP BY 1
ORDER BY
  CASE bucket
    WHEN '0'     THEN 0
    WHEN '1-5'   THEN 1
    WHEN '6-20'  THEN 2
    WHEN '21-50' THEN 3
    WHEN '50+'   THEN 4
  END;


-- ---------------------------------------------------------------------------
-- 4. retention_d1_d7_d30
-- Answers: For each signup-week cohort, what percent of users returned to
--          send ≥ 1 turn 1 / 7 / 30 days later?
-- Chart: Line (one series per d-window) or table.
-- ---------------------------------------------------------------------------
SELECT
  date_trunc('week', u.created_at)::date AS cohort_week,
  count(*)                                AS cohort_size,
  round(100.0 * count(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM analytics.turns_safe t
      WHERE t.user_id = u.id
        AND t.created_at >= u.created_at + interval '1 day'
        AND t.created_at <  u.created_at + interval '2 day'
    )
  ) / NULLIF(count(*), 0), 1) AS d1_pct,
  round(100.0 * count(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM analytics.turns_safe t
      WHERE t.user_id = u.id
        AND t.created_at >= u.created_at + interval '7 days'
        AND t.created_at <  u.created_at + interval '8 days'
    )
  ) / NULLIF(count(*), 0), 1) AS d7_pct,
  round(100.0 * count(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM analytics.turns_safe t
      WHERE t.user_id = u.id
        AND t.created_at >= u.created_at + interval '30 days'
        AND t.created_at <  u.created_at + interval '31 days'
    )
  ) / NULLIF(count(*), 0), 1) AS d30_pct
FROM analytics.users_safe u
WHERE u.created_at >= now() - interval '90 days'
GROUP BY 1
ORDER BY 1;


-- ---------------------------------------------------------------------------
-- 5. avg_turns_per_active_user_per_week
-- Answers: When users are active in a given week, how many turns do they take?
-- An "active user" is one with ≥ 1 turn in that week.
-- Chart: Line.
-- ---------------------------------------------------------------------------
SELECT
  date_trunc('week', t.created_at)::date AS week,
  count(*)::float / NULLIF(count(DISTINCT t.user_id), 0) AS avg_turns_per_active_user
FROM analytics.turns_safe t
WHERE t.created_at >= now() - interval '90 days'
GROUP BY 1
ORDER BY 1;


-- ---------------------------------------------------------------------------
-- 6. top_5_selected_practices
-- Answers: Which of the 12 practices are users picking most? (Onboarding signal.)
-- Chart: Bar.
-- ---------------------------------------------------------------------------
SELECT
  practice,
  count(DISTINCT user_id) AS users
FROM (
  SELECT id AS user_id, jsonb_array_elements_text(mapped_practices) AS practice
  FROM analytics.users_safe
  WHERE jsonb_typeof(mapped_practices) = 'array'
) flat
GROUP BY practice
ORDER BY users DESC
LIMIT 5;


-- ---------------------------------------------------------------------------
-- 7. turn_latency_p50_p95_p99_by_day
-- Answers: Is the coaching turn meeting the CLAUDE.md p99 ≤ 3 s budget?
-- Chart: Multi-line (three series, one per percentile).
-- ---------------------------------------------------------------------------
SELECT
  date_trunc('day', created_at)::date AS day,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY latency_ms) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_ms,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99_ms
FROM analytics.turns_safe
WHERE created_at >= now() - interval '30 days'
  AND latency_ms IS NOT NULL
GROUP BY 1
ORDER BY 1;


-- ---------------------------------------------------------------------------
-- 8. estimated_total_tokens_by_day
-- Answers: Roughly, how many tokens are we consuming per day?
-- Caveat: prompt_logs.token_count is a chars/3.5 estimate, NOT the
-- provider-reported usage. Useful as a relative-trend signal, not a billing
-- figure. Use the provider dashboard for billing.
-- Chart: Line.
-- ---------------------------------------------------------------------------
SELECT
  date_trunc('day', created_at)::date AS day,
  sum(token_count)                    AS estimated_tokens
FROM analytics.prompt_logs_safe
WHERE created_at >= now() - interval '30 days'
GROUP BY 1
ORDER BY 1;


-- ---------------------------------------------------------------------------
-- 9. active_hours_heatmap_30_days
-- Answers: What hours of day are users most active? (Schedule daily prompts
-- around this.)
-- Chart: Pivot / heatmap (x = day, y = hour, z = turn count).
-- ---------------------------------------------------------------------------
SELECT
  date_trunc('day', created_at)::date          AS day,
  extract(hour FROM created_at)::int           AS hour_utc,
  count(*)                                     AS turns
FROM analytics.turns_safe
WHERE created_at >= now() - interval '30 days'
GROUP BY 1, 2
ORDER BY 1, 2;


-- ---------------------------------------------------------------------------
-- 10. median_time_to_first_turn
-- Answers: After signup, how long until a user sends their first turn?
-- (Lower = faster activation.)
-- Chart: Single big-number Question (median seconds) plus a histogram.
-- ---------------------------------------------------------------------------
SELECT
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY extract(epoch FROM (first_turn_at - signed_up_at))
  ) AS median_seconds_to_first_turn
FROM (
  SELECT
    u.created_at AS signed_up_at,
    min(t.created_at) AS first_turn_at
  FROM analytics.users_safe u
  JOIN analytics.turns_safe t ON t.user_id = u.id
  GROUP BY u.id, u.created_at
) per_user
WHERE first_turn_at IS NOT NULL;
