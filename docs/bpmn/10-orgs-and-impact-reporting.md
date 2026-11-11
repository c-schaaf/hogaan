# 10 — Organizations, Cohorts, Impact Reporting

**Status:** living contract — update in the same PR that changes this process.
**Last reviewed:** 2026-11-11 (created in the context-and-connections build, P5.1–P5.4).
**Flag:** `FEATURE_ORGS` (default off).

## Purpose

Let a funder or program sponsor seats for a cohort and see impact, without
ever seeing an individual. "Private, always" and sponsor reporting are held
together by two things: the minimum group size (D5) and a plain statement
to every leader of what their sponsor can and cannot see (P5.4).

## Flow

```
[sponsor] POST /api/orgs → becomes org admin
          POST /api/orgs/:id/cohorts {name, seatLimit}
          POST /api/cohorts/:id/invites → HGN-XXXX-XXXX (SHA-256 stored, shown once)
        ▼
[leader]  Profile → Sponsored programs: reads what a sponsor can / cannot see,
          ticks "I have read…", enters code
          POST /api/cohorts/join {code, acknowledged: true}
            invalid / expired / full / ended → refused
          active member of a cohort that has not ended = Sponsored plan (BPMN 09)
          Leave any time → seat freed
        ▼
[sponsor] GET /api/cohorts/:id/report (org admins only; others get 404)
          SELECT FROM analytics.cohort_report  ← D5 floor inside the view:
            no row unless >= 10 leaders enrolled → API says "suppressed"
          GET …/report.csv  (same numbers); "Print or save as PDF" in the browser
```

## Metric glossary (Layer 4, `drizzle/0022`)

| Metric | Definition (view) |
|---|---|
| Coaching session | non-private session with ≥ 1 turn (`analytics.metric_coaching_sessions`) |
| Active leader | ≥ 1 coaching session in the ISO week (`metric_active_leaders`) |
| Moment prepared | a moment not dismissed (`metric_moments_prepared`) |
| Loop closed | moment prepared and reflected on (`metric_loops_closed`) |
| Self-reported outcome | well / mixed / hard (`metric_outcomes`) |
| Practice coverage | practices a leader has in focus (`metric_practice_coverage`) |
| Confidence change | after − before, 1–5, when both given (`metric_confidence_change`) |
| Helpful rate by prompt version | `metric_rating_by_prompt_version` (P2.4) |

The cohort report counts activity from each member's join date. It never
contains ids, names, emails, titles, or message content.

## Not built

- A server-generated PDF (the report page prints cleanly to PDF instead).
- Rules for who may create sponsor organizations in production (open on the fork).

## Key files

`src/orgs/{store,routes,sponsorship}.ts`, `drizzle/0022_orgs_cohorts_metrics.sql`,
`web/src/phases/Sponsor.tsx`, `web/src/components/SponsorshipCard.tsx`
