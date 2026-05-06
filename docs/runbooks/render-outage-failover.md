# Runbook: Render Outage — Failover to Railway / Fly

**Severity**: P0 — All Hogaan endpoints (coaching webhook, sponsor portal,
healthchecks) unavailable.

**Trigger signals**:
- BetterStack heartbeat fails for >3 consecutive intervals (≈3 min).
- Render status page (https://status.render.com) reports a regional outage
  affecting `eu-central-1` (or whichever region we're deployed to).
- Direct curl to `https://hogaan.onrender.com/healthz` returns 5xx /
  connection refused.

**Estimated time-to-recovery**: 15–60 min (cold standby restore).

---

## Decision: do we failover?

Failover is disruptive. Consult the matrix:

| Render outage signal | Action |
|---|---|
| `< 10 min` and Render status acknowledges incident | **Wait.** Most Render incidents resolve in <15 min. |
| `10–30 min` with no ETA on status page | **Prepare failover** (run Step 1–3 on standby; do NOT switch DNS). |
| `> 30 min` OR Render confirms multi-hour outage | **Execute failover.** |
| User-visible damage (e.g. Phase A users blocked from coaching) | Failover regardless of duration. |

## Step 1 — Stand up the standby app on Railway (cold)

Hogaan's runtime is dependency-light: Node 22 + Fastify + outbound
HTTPS. It runs anywhere Node runs.

1. Sign into Railway (account already provisioned for ops; creds in 1Password).
2. Create new service: `New > Deploy from GitHub repo > muhsinwarfa/hogaan`.
3. Branch: `main`. Build command: `pnpm install && pnpm build`. Start
   command: `pnpm start`.
4. Set every env var from Render's prod environment. Pull from 1Password
   `Hogaan / Render prod env` note. Critical:
   - `DATABASE_URL` (same Supabase — multi-tenant safe)
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
   - `ENCRYPTION_KEY_BASE64`, `JWT_SECRET_BASE64` (must match Render so
     existing sessions and encrypted columns still decrypt)
   - `TWILIO_*`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `VOYAGE_API_KEY`,
     `RESEND_API_KEY`
5. Wait for Railway to deploy and report healthy.

## Step 2 — Verify standby health

Run all of these against Railway's preview URL:

```
curl -sf https://<railway-url>/healthz
curl -sf https://<railway-url>/readyz
```

Run a synthetic coaching turn via `scripts/verify-phase-7.ts` with
`PUBLIC_BASE_URL=https://<railway-url>` and confirm the assistant
response makes it back end-to-end.

## Step 3 — DNS failover

Hogaan currently uses Render's default `*.onrender.com` URL — there's no
custom domain in front of it. Failover therefore means changing the URL
that external services point to:

1. **Twilio webhook** — go to Twilio console > WhatsApp Senders >
   our sender > Inbound Webhook URL. Change to
   `https://<railway-url>/webhooks/twilio/inbound`. Save.
2. **Sponsor portal** — update `SPONSOR_PORTAL_BASE_URL` env var on
   Railway to the Railway URL so magic-link callbacks resolve.
3. **Resend** — no DNS change needed (Resend dispatches outbound; not
   affected by us hosting elsewhere).

## Step 4 — Pause Render deploys

1. On Render, pause auto-deploy on the `web` service so a Render
   recovery doesn't unexpectedly start sending Twilio webhooks back to a
   half-dead Render container.
2. Note the pause in the incident channel.

## Step 5 — Verify recovery

1. From a sandbox phone, send an inbound message. Confirm response back.
2. Sign into sponsor portal via magic link. Confirm dashboard renders.
3. Run `scripts/verify-phase-9.ts` against Railway. Should print 10/10 PASS.

## Step 6 — Post-incident: cut back over OR stay on Railway

Once Render reports healthy, decision matrix:

| Condition | Action |
|---|---|
| Failover took <2h, no user impact, Render fully recovered | Cut DNS back to Render after Render runs clean for 30 min. |
| Failover took >2h, users were affected | Stay on Railway for at least 7 days while writing post-mortem. |
| Render had a multi-day outage | Re-evaluate hosting — consider Railway as primary going forward. |

## Step 7 — Post-incident

- File incident in Notion under `Operations > Incidents`.
- If failover was needed and worked, write up the actual cut-over time
  vs the runbook's estimate. Adjust the runbook for next time.
- If failover was needed and DID NOT work, this is a P0 followup —
  drill the runbook quarterly until failover is reliable.

---

## Verification: tabletop drill

This runbook has a corresponding tabletop test in
`tests/phase-10/runbook-tabletop.test.ts`. The test walks through each
step's checklist and asserts the documented commands / env vars / URLs
exist in the codebase. Re-run quarterly.
