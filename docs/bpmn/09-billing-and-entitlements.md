# 09 — Billing + Entitlements

**Status:** living contract — update in the same PR that changes this process.
**Last reviewed:** 2026-11-11 (created in the context-and-connections build, P4.1–P4.4).
**Flag:** `FEATURE_BILLING` (default off — while off, everyone is unlimited, as today).
Built against stripe-node 23.0.1 (API version 2026-09-30.endive), TEST MODE only on the fork.

## Plans (D1)

| Plan | How | Sessions | Follow-ups | MCP | Connections |
|---|---|---|---|---|---|
| Free | default | 3 new per calendar month (UTC) | no | no | no |
| Personal | Stripe, $20/month | unlimited | yes | yes | yes |
| Sponsored | active cohort seat (BPMN 10) | unlimited | yes | yes | yes |

Same coach, model and memory on every plan (P4.3). One module decides:
`src/entitlements/index.ts` (`planFor`, `hasCapability`, `newSessionAllowance`).

## Upgrade

```
[Profile → Plan → Upgrade] POST /api/billing/checkout
   → Stripe-hosted Checkout (mode subscription, client_reference_id = user id,
     subscription_data.metadata.hogaanUserId)
   → Stripe → POST /api/billing/webhook (raw body, Stripe-Signature verified)
        checkout.session.completed      → subscriptions: personal / active
        customer.subscription.updated   → status, period end, cancel_at_period_end
        customer.subscription.deleted   → status canceled  → back to Free
   each event id recorded in billing_events → retries are no-ops
[Manage or cancel] POST /api/billing/portal → Stripe customer portal
```

Paid statuses: `active`, `trialing`, `past_due` (grace while Stripe retries).

## Enforcement points

- Chat: a NEW session for a Free leader over the cap → 402 with a friendly
  message pointing to Profile → Plan (P4.4). Continuing a session is never blocked.
- `moment.followup` job: skipped (no email) unless `followUps`.
- `/api/mcp/tokens` → 402 `upgrade_required`; `/mcp` → 403 unless `mcp`.

## Departure from the plan

P4.2 said to reuse the per-user rate limiter for the session cap. The cap is
counted from the `sessions` table instead: a limiter counts attempts (a
retried request would burn a session), resets on a rolling window rather
than the calendar month, and needs Redis in demo mode.

## Key files

`src/entitlements/index.ts`, `src/billing/{stripe,routes}.ts`,
`drizzle/0021_billing.sql`, `web/src/components/BillingCard.tsx`
