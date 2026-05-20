-- SCRUM — `0012_analytics_schema.sql:18` created `metabase_reader` with a
-- hardcoded placeholder password (`'metabase_placeholder_rotate_me'`). If
-- the operator didn't rotate it post-deploy, that's a known credential on a
-- role that owns the analytics views. This migration drops the LOGIN
-- privilege and the placeholder password.
--
-- Production Metabase access is now provisioned out-of-band by creating a
-- fresh role inheriting metabase_reader's grants and setting its password
-- via psql from a privileged session — never via migration SQL. See the
-- runbook in `docs/runbooks/metabase-setup.md` (updated in this PR).

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'metabase_reader') THEN
    ALTER ROLE "metabase_reader" NOLOGIN PASSWORD NULL;
  END IF;
END
$$;

COMMIT;
