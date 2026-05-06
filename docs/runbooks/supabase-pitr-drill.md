# Runbook: Supabase Point-in-Time Recovery (PITR) Drill

**Severity**: practiced quarterly; executed under P0 on real data loss.

**Trigger signals (real)**:
- Accidental destructive query (`DELETE FROM users` etc.) reported by ops.
- Postgres corruption / Supabase incident affecting our project.
- Inadvertent rollback or migration mishap.

**Estimated time-to-recovery**: 30–90 min for a recent point (≤24h ago);
longer for older points depending on Supabase's PITR window (Pro tier =
7 days).

---

## Drill: simulated data loss + restore

This is the **drill** procedure — practice it once a quarter against the
**staging** project. Do NOT run on prod for practice. The real-incident
procedure is in the next section.

### Drill prep

1. Take note of the current row count of `users` and `turns` in staging:
   ```sql
   SELECT count(*) AS users FROM users;
   SELECT count(*) AS turns FROM turns;
   ```
   Record the pre-drill snapshot timestamp (UTC) — call it `T_0`.

2. Wait 5 minutes (so PITR has captured `T_0`).

### Drill execution

3. Apply a synthetic destructive change in staging. Pick something
   unambiguously the drill action — e.g.:
   ```sql
   INSERT INTO users (phone_hash, status) VALUES ('drill-token-' || gen_random_uuid(), 'provisional');
   ```
   Or `UPDATE` a single row with a known sentinel value.
4. Note the timestamp `T_1` (after the drill change).

### Drill recovery

5. Open Supabase dashboard > project > Database > Backups > PITR.
6. Choose the timestamp **just before T_1** (i.e., a state that doesn't
   have the drill change). PITR restores to a NEW project — Supabase
   does NOT overwrite the existing project for safety.
7. Wait for the restore to complete (Supabase shows progress; usually
   10–30 min for a project our size).
8. Inspect the restored project's `users` table — confirm the drill
   change is absent.
9. Confirm the row count matches your pre-drill snapshot.

### Drill cutover (cleanup, not a real cutover)

In a drill we do NOT need to cut over — we just verify the restored
project has correct data. After verification:

10. Delete the restored project (Supabase dashboard).
11. In staging, manually undo the drill change:
    ```sql
    DELETE FROM users WHERE phone_hash LIKE 'drill-token-%';
    ```
12. File drill report in Notion: time elapsed, anything surprising.

---

## Real incident: data loss recovery

### Step 1 — Stop the bleeding

1. Whatever query caused the data loss — kill any in-progress version of
   it. Connect via psql and `pg_terminate_backend()` if needed.
2. Pause every cron job that writes to the affected table (Render dashboard).
3. If the inbound webhook would write to the affected table, return 503
   to Twilio — they retry, and we don't compound the loss with new writes
   on top of a corrupted state.

### Step 2 — Decide the recovery point

Open Supabase dashboard > Database > Backups > PITR. Pick the latest
timestamp **before** the destructive event.

The PITR window is **7 days** on the Pro tier. If the loss is older than
7 days, recovery is impossible from PITR — escalate to Supabase support
to check raw WAL backups (no SLA on this).

### Step 3 — Restore to a new project

1. Supabase will spin up a NEW project at the chosen timestamp. Note
   the new project's connection string.
2. Wait for restore to complete (10–60 min).

### Step 4 — Reconcile + cut over

This is the hard part. The restored project is at `T_recovery`. New
writes to prod between `T_recovery` and "now" need to be replayed.

Decision matrix:

| Time gap (T_now − T_recovery) | Action |
|---|---|
| < 5 min, no inbound traffic | Switch DATABASE_URL on Render to the new project. Done. |
| 5–60 min, low traffic | Replay inbound `whatsapp_messages` from Render logs (Axiom). Manual SQL inserts. |
| > 60 min, significant traffic | Hard call — accept data loss for the gap, OR write a custom replay script from Twilio's message log. |

### Step 5 — Verify

Run `scripts/verify-phase-7.ts` against the new DATABASE_URL. Confirm a
synthetic coaching turn round-trips.

Run `scripts/verify-phase-9.ts`. Confirm sponsor portal aggregations
return non-suppressed data on the seeded synthetic cohort (if it was
restored).

### Step 6 — Post-incident

- Notion incident entry with the timeline + recovery point chosen.
- If we lost any data, identify which users were affected. We don't
  proactively notify them (CLAUDE.md hard rule #4 + #5: PII discipline)
  but ops should be aware of the gap.
- Adjust runbook if any step was unclear under pressure.

---

## Verification: tabletop drill

This runbook has a corresponding tabletop test in
`tests/phase-10/runbook-tabletop.test.ts`. The test asserts the runbook's
key commands and decision matrices are documented in the markdown.
Re-run quarterly alongside the live PITR drill in staging.
