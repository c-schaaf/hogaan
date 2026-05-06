# Runbook: Twilio WhatsApp Sender Re-registration

**Severity**: P1 — coaching pipeline still works for users in the 24h
service window, but template-only outbound paths (daily prompts when
window closed) are broken. Onboarding new users is broken.

**Trigger signals**:
- Process #11 returns terminal end events `E12_PermanentDeliveryFailure`
  with Twilio code `63016` ("not registered as WhatsApp sender") or
  similar 4xx codes from Meta/Twilio.
- Twilio email reporting WhatsApp Business sender de-registration —
  often after a policy review or a number-port event.
- Sponsor portal shows daily prompts dispatching but never delivering;
  Twilio webhook reconciliation reports `failed` status with sender errors.

**Estimated time-to-recovery**: 1–14 days (Meta approval is the bottleneck).

---

## Step 1 — Confirm the failure mode

1. In Twilio console > Messaging > Senders, locate the +254 sender. Note
   its current state — `Approved`, `Pending`, `Rejected`, or `Restricted`.
2. Check the sender's Business profile / display name — Meta sometimes
   demands a profile change before re-approval.
3. Run `pnpm exec tsx scripts/send-test-message.ts +254xxxxxxxxx` and
   capture the full Twilio error response. Save into the incident.

## Step 2 — Decide path

Decision matrix:

| Sender state | Path |
|---|---|
| `Pending` (we haven't re-registered yet) | Submit registration. |
| `Rejected` with cited reason | Address the reason, then submit. |
| `Restricted` (rate-limited by Meta) | Reduce send volume, wait, escalate via Twilio support. |
| `Approved` but failing | Not a re-registration issue — likely templates. See `whatsapp-account-suspension.md`. |

## Step 3 — Re-register the sender

1. Twilio console > Messaging > Senders > +254 sender > **Register**.
2. Fill in the WhatsApp Business profile:
   - Display name: `Hogaan` (must match the registered Meta business)
   - Business category: `Personal Coach`
   - Business description: short, plain — no superlatives ("the best").
3. Submit a starter template pack for re-approval (Meta requires at least
   one template before they'll re-approve a sender). Use the existing
   templates in our `library_versions.prompt_templates` library version
   `v1` — we already have 5 system templates, but Meta wants USER-FACING
   message templates (welcome, daily prompt, crisis resource list).
4. Wait for Meta approval. Standard SLA is 24h–7d.

## Step 4 — Mitigate while waiting

While the sender is re-registering, **active users in the 24h service
window can still receive coaching** (FreeForm path). The broken paths
are:

- New onboarding (Process #1) — pause new-user invites at the cohort
  level (sponsor portal admin action).
- Daily prompts to dormant users (Process #11 outside the 24h window) —
  these silently skip in `dispatchDailyPrompts` per the existing
  window-check logic. Acceptable degradation.

Communicate with sponsors via the sponsor portal banner (when we have
one — for Phase A, email the active sponsor admin manually).

## Step 5 — Once re-approved

1. Run the 3-mode verify-phase-8 script:
   ```
   pnpm exec tsx scripts/verify-phase-8.ts daily   --send +254xxxxxxxx
   pnpm exec tsx scripts/verify-phase-8.ts scenario --send +254xxxxxxxx
   pnpm exec tsx scripts/verify-phase-8.ts optout  --send +254xxxxxxxx
   ```
   All three must report PASS.
2. Resume new-user onboarding.
3. Sponsor portal banner cleared.

## Step 6 — Post-incident

- Notion incident entry with timeline (Meta SLA + our mitigation).
- If templates were the cause: retire the offending template, replace
  with one Meta would approve. Audit the prompt-templates library for
  similar risk.
- If the rejection was profile-name based: lock the display-name in
  ops handover docs so future re-registrations don't shift it.

---

## Phase A note

We currently use a single +254 production sender. There is no hot
standby. The plan §10.5 doesn't budget for a second sender; the
mitigation is the FreeForm-in-window path, which keeps engaged users
served.

If Phase A proves fragile against Meta de-registrations, evaluate adding
a second WhatsApp Business sender with a different vendor (e.g.
360Dialog) as backup. Track in Linear under `OPS-WHATSAPP-FAILOVER`.

---

## Verification: tabletop drill

This runbook has a corresponding tabletop test in
`tests/phase-10/runbook-tabletop.test.ts`. The test confirms the runbook
references commands and templates that exist in the codebase. Re-run
when senders move state.
