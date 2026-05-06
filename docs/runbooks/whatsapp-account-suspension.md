# Runbook: WhatsApp Business / Twilio Account Suspension Recovery

**Severity**: P0 — Coaching pipeline cannot dispatch outbound messages.

**Trigger signals**:
- Process #11 dispatch returns terminal end event `E11_AccountSuspended` (`DispatchAuthError` from Twilio API).
- Sentry alert `twilio account suspended or auth failed` from
  `Process_11.Step_8_APIDispatch`.
- Twilio email to the account owner indicating policy violation or
  payment failure.

**Estimated time-to-recovery**: 1–48 hours, depending on Meta/Twilio response.

---

## Step 1 — Confirm and contain

1. Open the Sentry incident in the `Process_11.Step_8_APIDispatch` source
   tag. Verify the `error: "auth"` tag is present.
2. In a separate terminal, hit the Twilio console
   (https://console.twilio.com/) and confirm the account status. Look for:
   - `Account Suspended` banner
   - WhatsApp Business sender status downgraded
3. Pause any active cron jobs that would issue outbound dispatches:
   ```
   # On Render dashboard: pause the daily-prompt cron + onboarding-nudge cron
   ```
   The pause prevents the Sentry feed from filling with E11 alerts while
   we work the recovery.

## Step 2 — Determine cause

Check the Twilio email and console for the suspension reason. Common causes:

- **Payment failure** → resolve billing on Twilio's side. Reactivation is
  usually instant once payment posts.
- **Policy violation (template)** → a template was sent that doesn't match
  the approved category. Identify which template; coordinate with Meta
  support to lift suspension.
- **Spam complaint** → recipient marked inbound as spam. Pull the
  `whatsapp_messages.correlation_id` from the offending message.
  Investigate whether that user opted out and we still dispatched.

## Step 3 — Recover

If billing:
1. Update payment method on Twilio.
2. Wait for confirmation email.
3. Resume crons.

If policy:
1. Open Twilio support ticket referencing the suspended sender's
   PhoneNumber SID.
2. Provide:
   - The most recent template SIDs we sent
   - A short narrative of the use case (sponsor-funded WhatsApp coaching)
   - Confirmation that all recipients consented during onboarding (Process #1)
3. While waiting: assemble a brief deflection plan — pause new-cohort
   onboarding so we don't accumulate undelivered users.

If spam:
1. Confirm the user is in `suppression_list` (they should be after
   marking spam — Twilio webhook reconciliation handles this).
2. If not, manually add their hashed phone:
   ```sql
   INSERT INTO suppression_list (phone_hash, reason, created_at)
   VALUES (encode(digest('+254xxx', 'sha256'), 'hex'), 'abuse', now());
   ```
3. Re-train the QC corpus + crisis red-team if the spam was triggered by
   a content issue.

## Step 4 — Verify recovery

1. From a sandbox phone, hit `POST /webhooks/twilio/inbound` with a
   benign coaching message.
2. Confirm Process #11 returns `E1_MessageDispatched` (not E11) in the
   `whatsapp_messages.terminal_end_event` column.
3. Resume crons.

## Step 5 — Post-incident

1. File post-incident report in Notion under `Operations > Incidents`.
2. If suspension was billing, set up redundant payment method.
3. If policy, audit recent templates for compliance and tighten the
   pre-approval review process.

---

## Failover note

Hogaan does **not** have an alternate WhatsApp Business provider. A
prolonged suspension (>48h) blocks coaching entirely. Mitigations
considered (none implemented yet):

- Maintain a second WhatsApp Business number with a different vendor
  (e.g., 360Dialog) as cold standby. Cost: ~$50/month idle.
- Build email fallback for daily-prompt cron only (not coaching turns).

These are **not in scope for Phase A**. Track in Linear under
`OPS-FAILOVER` if/when sustained suspension risk warrants the cost.
