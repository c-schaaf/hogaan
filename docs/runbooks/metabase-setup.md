# Runbook: Connect Metabase to the analytics schema

**Severity**: pre-launch setup — one-time per environment.

**Trigger**: First Metabase install OR a fresh prod DB.

**Estimated time**: 10–15 min.

---

## Purpose

Wire Metabase to a separate `analytics` Postgres schema with PII-masked
views, via a dedicated read-only `metabase_reader` role. Keeps BI access
isolated from prod-table changes and out of the application's
connection string.

## Prerequisites

- Migration `drizzle/0012_analytics_schema.sql` applied (creates the
  schema, the role, the indexes, and the four `*_safe` views).
- Supabase SQL editor access with a role that can `ALTER ROLE` (the
  postgres role or a service-role bypass).
- A self-hosted or cloud Metabase instance reachable from the prod DB.

## Step 1 — Apply the migration

In Supabase SQL editor, paste the contents of
`drizzle/0012_analytics_schema.sql` and run. Expected output: `COMMIT`
with no rows. Verify:

```sql
SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'analytics';
SELECT rolname FROM pg_roles WHERE rolname = 'metabase_reader';
SELECT table_name FROM information_schema.views WHERE table_schema = 'analytics';
```

You should see one `analytics` schema, one `metabase_reader` role, and
four views (`users_safe`, `sessions_safe`, `turns_safe`,
`prompt_logs_safe`).

## Step 2 — **MANDATORY: rotate the placeholder password**

The migration creates `metabase_reader` with literal password
`metabase_placeholder_rotate_me`. Anyone with read access to the
repo or the migration history can see it. Rotate immediately:

```sql
ALTER ROLE "metabase_reader" WITH PASSWORD '<paste-a-real-strong-password>';
```

Generate the password with:

```bash
openssl rand -base64 24
```

Store the result in 1Password under "Hogaan / metabase_reader".

If you skip this step, the entire control is a hope. Do not connect
Metabase before rotating.

## Step 3 — Connect Metabase

In Metabase admin → Databases → Add database:

- **Database type**: PostgreSQL
- **Host / port**: Supabase pooler endpoint, port `6543` (transaction
  mode) — the same shape you use for `DATABASE_URL`, with the
  application username swapped for `metabase_reader`.
- **Database name**: `postgres`
- **Username**: `metabase_reader`
- **Password**: the value from Step 2 (paste; do not commit).
- **Schemas**: limit to `analytics` (use the "Only these..." option).
  Metabase MUST NOT scan `public` — the role wouldn't have access
  anyway, but explicit narrowing keeps the schema browser clean.
- **SSL**: required.

Save. Metabase auto-syncs the schema; the four views will appear in the
data browser within 30 s.

## Step 4 — Verify

In Metabase, open the SQL editor and run:

```sql
SELECT count(*) FROM analytics.users_safe;
SELECT count(*) FROM analytics.sessions_safe;
SELECT count(*) FROM analytics.turns_safe;
SELECT count(*) FROM analytics.prompt_logs_safe;
```

All four should return a number (zero is fine on a fresh DB). If any
errors with `permission denied`, re-run the
`GRANT SELECT ON ALL TABLES IN SCHEMA "analytics" TO "metabase_reader"`
line from the migration.

Also confirm the role cannot reach the base tables:

```sql
SELECT count(*) FROM public.users;  -- expect: ERROR: permission denied for schema public
```

If `public.users` returns rows, the grant scope is wrong — STOP and
investigate before showing the dashboards to anyone.

## Step 5 — Build dashboards

Paste each block from `docs/analytics/kpi-queries.sql` into Metabase as
a new Question. Each query is self-contained, targets only
`analytics.*`, and returns cleanly-named columns so Metabase auto-labels
chart axes.

## Post-setup checklist

- [ ] Placeholder password rotated.
- [ ] Real password stored in 1Password.
- [ ] Metabase config schema-scope limited to `analytics`.
- [ ] All four views return row counts in Metabase.
- [ ] `SELECT FROM public.users` fails with permission denied.
- [ ] At least one KPI Question saved and rendering.

## Rollback

This setup adds a role + schema + views; nothing in `public` is
modified beyond six new indexes (all `IF NOT EXISTS`). To roll back:

```sql
DROP SCHEMA IF EXISTS "analytics" CASCADE;
DROP ROLE IF EXISTS "metabase_reader";
-- Indexes are kept; they are useful regardless of whether Metabase is wired.
```

## Known issues

- Metabase's "sample data" first-run wizard may try to auto-create
  tables in the first schema it finds. Always create the database
  connection with read-only role; the create-table will fail loudly.
- If turn-latency monitors trip in the 24h after the migration applies,
  one of the six new indexes is the likely cause — drop them one at a
  time, re-adding via `CREATE INDEX IF NOT EXISTS`.

## Tabletop drill

Tabletop quarterly: walk through Step 1 → Step 4 against a staging DB,
verify the views return data and the placeholder password is NOT what's
configured in Metabase. Capture the result in `audit-evidence/`.
