# Staging stack for the fork (P0.2)

**Status:** not stood up. The build agent had no accounts and no credentials,
so nothing below has been created. This is the checklist for whoever does it.

The fork must never point at production (build plan §0, D7). Every service
below gets its **own** staging account or project.

| Service | What to create | Env vars it fills | Test-mode? |
|---|---|---|---|
| Supabase | New project "hogaan-staging". Enable email auth. Copy URL, anon key, JWT secret, and the pooled Postgres URL. | `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Separate project = staging |
| Upstash | New Redis database "hogaan-staging". | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Separate database |
| Render | New web service from the fork's branch, `pnpm build` / `pnpm start`. | all of the below, set in Render | Separate service |
| Anthropic | Staging workspace + key with a low monthly spend cap. | `ANTHROPIC_API_KEY` | Spend-capped |
| Resend | Test sending domain (or `onboarding@resend.dev`). | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Test domain |
| Stripe | Use **test mode** only. Create a product "Hogaan Personal", $20/month recurring price. Add a webhook endpoint `https://<staging>/api/billing/webhook` for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. | `STRIPE_SECRET_KEY` (sk_test_…), `STRIPE_WEBHOOK_SECRET` (whsec_…), `STRIPE_PRICE_PERSONAL` | **Test mode** |
| Groq / Voyage | Optional on staging. | `GROQ_API_KEY`, `VOYAGE_API_KEY` | — |
| Secrets you generate | `openssl rand -base64 32` twice. | `ENCRYPTION_KEY_BASE64`, `EMAIL_LINK_SECRET` | — |

## Migrations

Apply every file in `drizzle/` in filename order to the staging database
(`psql "$DATABASE_URL" -f drizzle/00NN_….sql`). Migrations 0018 and later are
added by the context-and-connections build; they create new tables and
enum values and are **destructive to roll back** (dropping them deletes the
data they hold). Run `pnpm tsx scripts/seed-libraries.ts` and the
prompt-template publish script after migrating.

## Smoke test

1. Sign up with a real inbox, verify email, finish onboarding.
2. Send a chat message; see a streamed reply.
3. Turn on one feature flag at a time (see `.env.example`) and repeat the
   matching demo-mode click-through from `docs/plans/build-report.md`.
