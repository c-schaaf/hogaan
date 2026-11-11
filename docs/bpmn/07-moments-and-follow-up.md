# 07 — Moments, Follow-up, Reflection, Ratings, Weekly Nudge

**Status:** living contract — update in the same PR that changes this process.
**Last reviewed:** 2026-11-11 (created in the context-and-connections build, P2.1–P2.6).
**Flags:** `FEATURE_MOMENTS`, `FEATURE_FOLLOWUP_EMAIL`, `FEATURE_RATINGS`, `FEATURE_WEEKLY_NUDGE` (all default off).

## Moments (P2.1)

```
[leader mentions an upcoming conversation in a session]
        │ brief.update job (BPMN 06) also returns moments: what, with whom (ROLE), when
        ▼
[createMoment] PII filter → encrypt → insert (unique per user + normalized "what")
        │ also: leader adds one on /moments, or MCP log_moment (BPMN 08)
        ▼
[scheduleFollowUp] if FEATURE_FOLLOWUP_EMAIL and the moment has a time:
        enqueue moment.followup, dedupe followup:<momentId>,
        run_after = next 09:00 in the leader's timezone, ≥ 2 h after the moment
```

During each chat turn the upcoming moments are rendered into the
per-leader prompt block (one indexed query in the parallel context fetch).

## Follow-up (P2.2) — `moment.followup`

```
[job due] flag on? moment still upcoming and not yet followed up? else stop
        ▼
[sendProactiveEmail] (src/shared/email/proactive.ts)
   1. opted in to follow-ups and not unsubscribed?      no → stop (no email)
   2. idempotency key already used?                     yes → treat as sent
   3. ≥ 2 proactive emails in the last 7 days?          yes → reschedule after the window
   4. local time inside quiet hours (21:00–08:00)?      yes → reschedule to 08:00 local
   5. claim key in email_sends → Resend with Idempotency-Key + List-Unsubscribe
        ▼
[moment.followup_sent_at = now]  (one follow-up per moment, ever)
```

The email never says what the moment was; the link opens `/reflect/<id>`
in the app (sign-in required). Demo mode captures instead of sending.

## Reflection (P2.3)

`POST /api/moments/:id/outcome {howItWent, differently?, confidence…}` →
outcome row, moment `reflected`, pending follow-up cancelled, and a
`reflection` line appended to the leader's Notes (BPMN 06), so the next
session's prompt contains it.

## Ratings (P2.4)

`POST /api/turns/:id/rating` — helpful / not helpful + optional note
(PII-filtered, encrypted), stored with the rated turn's prompt version,
determinism hash and model. Turns now persist `library_versions`.

## Weekly nudge (P2.6) — `nudge.weekly`

Opt-in on Profile. Scheduled for the next Monday 09:00 local; sends one
prompt from the existing `daily_prompts` library (read-only use), chosen
by the leader's practices and the ISO week; re-arms itself weekly; stops
when the leader opts out or unsubscribes. Counts toward the 2-a-week cap.

Known limit: the weekly cap is checked then claimed, not atomically; two server
instances sending to the same leader at the same instant could exceed it.

## Failure modes

| Step | Failure | Behaviour |
|---|---|---|
| Moment insert | duplicate | ignored (unique index) |
| Send | Resend error | email_sends `failed`; job retried (backoff) then `failed` + P2 |
| Send | cap / quiet hours | job rescheduled, not a failure |
| Unsubscribe link | bad signature | 400 page, nothing changes |
| Unsubscribe link | opened by a link scanner (GET) | shows a confirmation page only; the POST (button or the mail provider's one-click, form-encoded) unsubscribes |

## Key files

- `src/moments/store.ts`, `src/jobs/phase2-handlers.ts`
- `src/shared/email/proactive.ts`, `src/shared/email/resend.ts`
- `src/web-api/phase2-routes.ts`
- `drizzle/0019_moments_and_feedback.sql`

## Meeting notes into a reflection (P6.2)

**Flag:** `FEATURE_MEETING_NOTES` (default off). Requires the `connections`
capability when billing is on.

```
[leader pastes notes on /moments or after a reflection]
        │ POST /api/meeting-notes/insights {notes ≤ 20,000 chars}
        ▼
[extractMeetingInsights] PII filter → background model (structured JSON)
        │ ≤ 5 insights about the leader, own words, others by role
        │ PII filter again on the way out
        ▼
[response {insights, stored: false}]  — the notes are never persisted or logged
        ▼
[leader ticks which to keep] → POST /api/brief/lines (normal, filtered path)
```

Key file: `src/meeting-notes/extract.ts`.
