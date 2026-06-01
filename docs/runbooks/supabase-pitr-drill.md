# Runbook: Supabase Point-in-Time Recovery (PITR) Drill

## How to use this

This runbook covers two scenarios:

1. **The planned drill** — a quarterly practice where Muhsin (and ideally Hamse) restore a copy of the database to a point in the past, just to make sure the process works. Read sections 1–4 below.
2. **The real incident** — someone accidentally deletes data, a migration goes bad, or Postgres corrupts. Hands shaking, 3am, real users affected. Read sections 5–8 below.

You don't need to be a database engineer to follow this. The "I have shell access and know psql" steps are explicitly marked; for everything else, the Supabase dashboard does the heavy lifting.

## Glossary

- **PITR** (Point-in-Time Recovery): Supabase Pro keeps a continuous backup of the database. You can restore to any 1-minute snapshot in the last 7 days.
- **WAL** (Write-Ahead Log): the change log Postgres uses to enable PITR. You don't interact with it directly; Supabase manages it.
- **Restore-to-new-project**: Supabase NEVER overwrites your production database during a restore. It spins up a brand-new project containing the data as it existed at the recovery point. You then decide what to copy back to prod.
- **Cutover**: the moment you switch the live app from talking to the broken database to talking to the restored one. Usually the hardest minute of the incident.

## Honest reality check (read before anything else)

**This runbook has not been live-drilled yet.** F12 in the Risk Register specifically calls this out — every time estimate below ("30-90 min recovery", "10-30 min restore time", etc.) is from Supabase's documentation, not from us having proven it. The first live drill will be the one that validates these numbers and surfaces what's actually confusing.

**We do not have a permanent staging project yet.** For the first drill, we will spin up a temporary Supabase project (free tier) just for the exercise and tear it down afterward. Future drills can graduate to a permanent staging project if we decide it's worth the monthly cost.

## Trigger signals (when you actually run this for real)

You're in incident-mode if any of the following are true:

- Someone (yourself, Claude, an AI agent, a future engineer) ran a destructive query against prod (`DELETE FROM users` with a bad `WHERE` clause; `DROP TABLE`).
- A migration broke something in a way that can't be fixed forward.
- Supabase itself reports corruption or data inconsistency on our project.
- A bug in the application code mass-deleted user data (e.g. the account-deletion endpoint accidentally cascading too broadly).
- A tester reports "all my conversations are gone" — investigate first, but if it's real and recent, PITR is the answer.

---

## SECTION A — The planned drill (quarterly, on staging)

### 1. Prep — spin up a temporary staging project

If this is your first drill, you don't have a staging project yet. Spin one up:

1. Go to https://supabase.com/dashboard → New Project.
2. Name it `hogaan-staging-drill-<YYYYMMDD>` so it's clearly disposable.
3. Pick the free tier (this is throwaway).
4. Note the project's connection string.
5. **For the very first drill,** seed the staging project with a copy of the current prod schema:
   - In prod Supabase dashboard → Settings → Database → "Database password" — note it.
   - Use `pnpm db:migrate` against the staging connection string. This applies every migration in `drizzle/` to the empty staging DB.
   - Insert a few synthetic users and turns so there's something to recover. About 10 rows is plenty.

**Note:** the free tier does NOT include PITR. For drill purposes, the practice value is in walking through the dashboard steps, not testing the actual restore. Once we have a paid staging project (decision for after the first drill), the full PITR mechanic becomes drillable.

### 2. Drill prep — record the "before" state

Connect to staging (Supabase dashboard → SQL editor) and run:

```sql
SELECT count(*) AS user_count FROM users;
SELECT count(*) AS session_count FROM sessions;
SELECT count(*) AS turn_count FROM turns;
SELECT now() AT TIME ZONE 'UTC' AS t_zero;
```

Write these four numbers down. We'll compare them to the post-restore state to confirm the restore worked.

### 3. Drill execution — simulate data loss

Apply a synthetic destructive change. Pick something obvious so you can recognize it later:

```sql
-- Insert a row that's clearly the drill action.
INSERT INTO users (id, email, supabase_user_id, status)
VALUES (gen_random_uuid(), 'drill-' || gen_random_uuid() || '@example.com', gen_random_uuid(), 'provisional');

-- Or update an existing row with a sentinel:
UPDATE users SET status = 'drill-corrupted' WHERE id = (SELECT id FROM users LIMIT 1);
```

Record the timestamp `T_1` (when you applied the change).

### 4. Drill recovery — restore from PITR

1. Open the Supabase dashboard → your staging project → Database → Backups → PITR.
2. Choose a timestamp **just before T_1** (a state that doesn't have the drill change).
3. Click **Restore**.
4. Supabase spins up a NEW project at that timestamp. Wait for it to finish (the dashboard shows progress; expect 10-30 minutes for a small project).
5. Connect to the new project (it has its own connection string).
6. Re-run the row-count queries from step 2. The numbers should match the pre-drill state, and the sentinel rows from step 3 should be absent.
7. Note the elapsed time from step 4 to step 6 — this is your real recovery time.

### 4b. Drill cleanup

After verification:

1. Delete the restored project from the Supabase dashboard (Settings → General → Delete project).
2. Optionally delete the staging-drill project too if you're not planning more practice in the next quarter.
3. File a 1-page drill report in `docs/audit-evidence/drills/YYYY-MM-DD-pitr-drill/`:
   - Time you started the drill
   - Time the restore completed
   - Anything that was confusing
   - Anything in this runbook that was wrong or unclear
   - Update the runbook before you close the doc — that's how it stays sharp.

---

## SECTION B — The real incident (production data loss)

### 5. Stop the bleeding

Before you touch backups, stop the destruction from continuing.

1. **Pause the app.** Go to https://dashboard.render.com/web/srv-d8arufbbc2fs7399vqr0 → Manual Deploy → **Suspend Service**. This stops new coaching turns from writing to prod. (Users will see the F4 error message.)
2. **Confirm the bad query stopped.** If you (or an agent) ran a destructive query, make sure it's not still running. In Supabase dashboard → Database → Roles → check for active sessions. Kill any that look related: `SELECT pg_terminate_backend(<pid>);` from the SQL editor.
3. **Tell Hamse.** Phone. Right now. This is a P0 incident. He decides whether to tell the testers.

### 6. Decide the recovery point

1. Open https://supabase.com/dashboard → your prod project → Database → Backups → PITR.
2. The dashboard shows your 7-day window. Pick a timestamp **just before the destructive event**.
3. If the loss is **older than 7 days**, PITR cannot help you. Skip to step 8 (Escalate to Supabase support).

**Decision aid:** if you're not sure exactly when the destruction happened, pick 5 minutes BEFORE the earliest moment you noticed something was wrong. Cheaper to lose 5 minutes of legitimate writes than to restore to a moment that's still corrupted.

### 7. Restore to a new project

1. Click **Restore** in the PITR panel. Supabase spins up a new project at the chosen timestamp.
2. Note the new project's connection string somewhere safe.
3. Wait for restore. Plan for 10–60 minutes depending on database size.
4. While you wait: **pull in Claude.** Open Claude Code in the repo and post the symptom + estimated recovery time. Claude can help draft the customer comms while you focus on the technical work.

### 8. Reconcile + cut over

This is the hardest step. The restored project shows the data as it was at `T_recovery`. New writes that happened in prod between `T_recovery` and "now" are gone unless we manually replay them.

**Current architecture reality:** at beta scale (5 testers, ~50 turns/day), the volume of writes during a typical recovery window is small. Most realistic recovery scenarios involve a few hundred lost turns, not millions.

Use the decision matrix:

| Time gap (T_now − T_recovery) | Action |
|---|---|
| **< 5 min, no testers actively in-session** | Switch `DATABASE_URL` on Render to the new project's connection string. Resume Render service. Done. |
| **5–60 min** | Accept the data loss for the gap (5 testers × 60 min × 1 turn / 12 min = ~25 lost turns worst case). Pull a list of affected `userIdHash` from Axiom for that window. Switch DATABASE_URL. Resume service. Email affected testers an apology with the gap window. |
| **> 60 min, OR testers reporting active loss** | Hard call. Either accept the loss and apologize, OR write a custom replay script reading TurnTrace events from Axiom and re-inserting them. The script doesn't exist; building it is a 2-3 hour engineering exercise during an active incident. Default to "accept the loss" unless Hamse says otherwise. |

#### Cutover detail

1. In Render → Environment, change `DATABASE_URL` to the restored project's connection string.
2. Click **Resume Service** to bring the app back online.
3. Resume the Render service. The app now writes to the restored project.
4. Run a smoke test: sign in as your own test user on https://app.hogaanai.com, send one coaching turn, confirm it persists. Look at the sessions list. If anything's off, you may need to recover further back.

### 9. Verify and declare done

Run these checks against the restored database (now serving prod traffic):

```sql
-- Schema sanity: every expected table exists.
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1;

-- Row counts: do the numbers feel right compared to your last known good?
SELECT count(*) FROM users;
SELECT count(*) FROM sessions;
SELECT count(*) FROM turns;
```

End-to-end check:

1. Sign in at https://app.hogaanai.com with a real test account.
2. Send a coaching turn. Confirm it persists.
3. Open the sessions list. Confirm it loads.
4. Check Axiom (https://app.axiom.co/hogaan-df5k/datasets/hogaan) — a new TurnTrace should appear within a minute.
5. Check Sentry (https://hogaan-lj.sentry.io/issues/?project=4511331978313728&statsPeriod=30d) for any new errors triggered by the cutover.

If all of the above are green for 10 consecutive minutes, you can declare the incident resolved.

---

## SECTION C — After every incident (or drill)

1. **Document the timeline** in `docs/audit-evidence/incidents/YYYY-MM-DD-<slug>/`:
   - When the loss started
   - When it was detected
   - When you started the recovery
   - When the cutover happened
   - When you declared done
   - Anything that was confusing or wrong in this runbook
2. **Notify affected testers** if any of them are likely to have noticed (via Muhsin → text or email; Hamse if it's broader than a few testers).
3. **Update this runbook** before you close the incident — every imperfection here is a future-you tax.
4. **Add to the daily ritual** any new check that would have caught this earlier.

## SECTION D — Escalate to Supabase support

Use this if PITR can't help (loss older than 7 days, restore fails, or the dashboard doesn't show the timestamp you need):

- Supabase support: https://supabase.com/support → submit ticket → mark "Database / Outage."
- Mention you're on Pro tier and need WAL-level recovery if PITR is exhausted.
- No SLA on this path. Be honest with Hamse and testers about the timeline being unknown.

---

## Verification

The corresponding tabletop test lives at `tests/phase-10/runbook-tabletop.test.ts`. It pins the runbook's structural invariants (PITR window mentioned, current schema referenced, decision matrix present) so this doc can't silently drift back to the WhatsApp-era version.

*Last updated: 2026-06-01. First live drill: pending Hamse window.*
