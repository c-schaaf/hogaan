# Build report: context, connections, proactivity

Branch: `build/context-and-connections` on the fork `c-schaaf/hogaan`.
Written 2026-11-11 by the build agent, after one run through Phases 0–6 of
`docs/plans/context-and-connections-build-plan.md`.

Nothing here is merged, deployed, or opened as a pull request. Every new
capability sits behind a feature flag that is **off** unless someone turns
it on, so merging this branch would not show leaders anything new (the few
things that do change even with every flag off are listed in section 5,
item 1).

A word on honesty in this report: "**ran and saw it pass**" means I ran
the test or clicked through it myself in this session. "**wrote it**" means
the code exists but I could only check it against a stand-in (a "fake" or
"stub": a small piece of test code that pretends to be the real service).

---

## 1. How to try it

You need Node 22 and pnpm 9 (the same tools the repo already needs).

```bash
pnpm install
pnpm demo
```

Then open **http://localhost:3000**. You are signed in as a fictional
sample leader, "Amina Farah", a program manager at a housing nonprofit.
A yellow bar at the top says you are in demo mode. Nothing is saved after
you stop the demo (Ctrl+C), and nothing is sent anywhere.

The coach in demo mode is a **scripted stand-in**, not the real AI coach:
every reply starts with "(Demo coach: scripted reply, no AI model
connected.)" and it is not Hamse's voice. If you put an `ANTHROPIC_API_KEY`
in a `.env` file at the repo root, the demo uses the real model instead
(this costs a little money per message).

What to click, in order:

1. **Home.** Note the line "1 conversation ready to reflect on". Type
   anything into "Tell me what happened today…" and press Enter. The new
   session opens with "Last time we left this open: …", which came from
   Amina's past sessions (Phase 1). Under the reply, try **Helpful / Not
   helpful** (Phase 2).
2. **Profile → What Hogaan knows about you → View and edit.** This is
   everything kept about Amina between conversations. Edit a line, delete
   one, add one, or delete everything (Phase 1).
3. **Home → "1 conversation ready to reflect on"** (or Profile → Moments).
   Press **Run background work now** in the yellow "Demo controls" box. The
   "Demo outbox" shows the follow-up email and the weekly question that
   would have been sent, each with a one-click unsubscribe link. Click
   **How did it go?**, pick an answer, save. Then go back to "What Hogaan
   knows about you": the reflection is now in the notes (Phase 2).
4. On the Moments page, scroll to **Reflect from meeting notes**. Paste a
   few sentences of made-up meeting notes and press **Suggest insights**.
   Tick the ones to keep. The pasted notes are never saved (Phase 6).
5. **Profile → Use Hogaan from your AI assistant → Connect an assistant.**
   You get a server address and a key, shown once. That is how a leader's
   own AI assistant would connect to Hogaan (Phase 3).
6. **Profile → Plan.** Amina starts on Personal. Press **Cancel plan
   (demo)**: she drops to Free and sees "2 of 3 new sessions this month".
   Start two new chats from Home: the second is refused with a friendly
   message. **Upgrade to Personal (demo, no payment)** restores everything
   (Phase 4). No money or card is involved.
7. **Profile → Sponsored programs.** Read what a sponsor can and cannot
   see. Then **I fund or run a program → sponsor reports**. "Fall 2026
   Fellows" (11 leaders) shows a report with totals only. "Spring pilot" (6
   leaders) shows no report, because it is under the 10-person privacy
   floor (Phase 5). In the demo, Amina is the funder's administrator;
   sponsors are not allowed to join their own cohorts, so the leader's side
   is the "Sponsored programs" card on her Profile.

To see the app exactly as it would behave after merging with everything
off, there is no special command: the normal server (`pnpm dev` with real
settings) starts with every flag off.

---

## 2. Built and verified

"Verified" here means: tests I ran and saw pass, plus a click-through of
the demo in a real (headless Chromium) browser. The tests use a real
Postgres database running inside the test process (PGlite, an embedded
version of Postgres), with every migration applied, so the new database
tables, views and privacy rules were exercised for real. External services
(the AI model, Stripe, Resend email) are stand-ins.

### Final check results (last run, on the final commit)

All run by me on the final code (commit after the security-review fixes):

| Check | Command | Result |
|---|---|---|
| Typecheck (server) | `pnpm typecheck` | pass |
| Typecheck (browser code) | `npx tsc -p web/tsconfig.json --noEmit` | no errors in any new or changed file; 2 old errors in `web/src/__tests__/auth/email-verify.test.tsx` (unused imports, there before this work) |
| Lint + formatting | `pnpm lint` | pass |
| Backend tests | `pnpm test` | **484 passed**, 4 to-do, 0 failed (76 files) |
| Route tests | `pnpm test:routes` | **89 passed**, 0 failed (13 files) |
| Web tests | `pnpm test:web` | **128 passed**, 0 failed (19 files) |
| Production build | `pnpm build` | pass |
| End-to-end browser suite | `pnpm test:e2e` | **not run** (cannot start here; see section 3) |

That is 97 new backend tests and 4 new web tests. No existing test was
deleted or skipped; one existing test (`tests/db/rls-coverage.test.ts`)
pins the list of tables with row-level security, and I added each new
table to it deliberately, as that test intends.

Before I started (untouched fork, same checks): typecheck pass, lint pass,
backend 387 passed / 4 to-do, routes 89 passed, web 124 passed, build
pass. The repo's docs claimed "385 backend and 124 frontend"; the real
backend count was 387.

### Phase 0 — baseline

- **P0.1** Installed and ran every check; all green with no dependency
  fixes needed.
- **P0.3** Stale docs fixed: `package.json` no longer says WhatsApp;
  `CLAUDE.md` now says `voyage-3` (the code's model); BPMN 04 now says memory
  is switched off and the writer has no caller.
- **P0.2** Every environment variable is documented in `.env.example`,
  marked where it must be a test-mode key. (The staging stack itself was not
  stood up; see section 4.)
- **P0.4** 40 realistic leader messages (`src/eval/cases.ts`) and a
  5-part rubric from the site's own claims: asks before it tells, stays on
  the leader's situation, draws on a practice, stays out of therapy,
  leaves the words to the leader (`src/eval/rubric.ts`). Run with
  `pnpm eval:coaching`. Tests: `tests/eval/rubric.test.ts`. I ran the
  harness end to end with the scripted coach to prove it works. **No real
  baseline score exists** (no model key; section 4).

### Demo mode (your addition)

- `pnpm demo` builds the web app and starts the real server on an embedded
  database with one seeded leader, an in-memory stand-in for Redis, a
  sign-in that only ever means "the sample leader", and the scripted coach
  when there is no model key.
- **It refuses to run in production**, checked in three places: the config
  loader refuses `DEMO_MODE` with `NODE_ENV=production`, the `pnpm demo`
  launcher refuses, and the demo sign-in code itself refuses. It also
  deletes any real database, Supabase, Stripe, or email settings from its
  own process before starting. It also refuses `NODE_ENV=staging`, because
  its demo key is public. Tests: `tests/demo/demo-refusal.test.ts` (6), `tests/demo/demo-server.test.ts` (5).
- One real bug was caught here by that guard during the build: the web
  build step sets `NODE_ENV=production` inside the process, which made the
  demo refuse itself. Fixed by restoring the original value after the build.
- I started it and loaded every page in a browser (home, chat, sessions,
  profile, what Hogaan knows, moments, reflect, sponsor reports).

### Phase 1 — "remembers your context"

- **P1.1 Leader brief.** Three short documents per leader (profile, goals,
  notes) plus work-context fields, each encrypted in the database. After a
  leader goes quiet in a session, a background job asks the stronger model
  (`claude-opus-5-5`, per D3) to update the brief, never inside the chat
  turn. Each chat turn reads it with one quick database lookup, in
  parallel with the reads that already happen.
- **P1.2** Role, industry, organization type and size, team, and coaching
  preference: filled in from conversation (only if empty) and editable by
  the leader. No onboarding screens added.
- **P1.3** "What Hogaan knows about you" page: view, edit, delete any line,
  delete everything. Private sessions never write to it.
- **P1.4** The mechanism for a founder-approved "knowledge digest" in a
  cached part of the prompt. It only goes in if the digest is marked
  approved and names who approved it. Only a placeholder exists.
- **P1.5** Switching the live coach to `claude-haiku-5-5` is supported and
  follows the official migration guide (no temperature setting, explicit
  "effort" setting, room for the model's thinking). The default is still
  today's `claude-haiku-4-5`.
- **D2 privacy filter**: email addresses, phone numbers and surnames are
  stripped from everything sent to the model, in one place every model
  call goes through.
- **Done when, as tested:** `tests/leader-context/second-session.test.ts`
  — session 1, then the background update, then a brand-new session 2
  whose prompt contains the leader's role, team and open loop, with no
  prior messages carried over. The same test checks **every** model call
  (both chats and the background call) and finds no email, phone number,
  surname (including the leader's own), or a named colleague's surname.
  Other tests: `brief-routes.test.ts` (7), `tests/jobs/runner.test.ts` (4),
  `tests/pii/filter.test.ts` (9), `tests/shared/llm/model-params.test.ts`
  (4), `tests/libraries/knowledge-digest.test.ts` (2), web
  `context/context.test.tsx` (3), `concurrency.test.ts` (3: a slow
  background update can never overwrite a leader's edit or "delete
  everything").
- **Not verified:** "turn latency p99 is unchanged" (section 3).

### Phase 2 — close the loop

- **P2.1 Moments**: found by the background update, added by hand, or
  added by an AI assistant; listed on a Moments page; upcoming ones are
  given to the coach.
- **P2.2 Follow-up**: one email the morning after (09:00 in the leader's
  timezone), only if the leader opted in; at most 2 proactive emails a
  week; never during quiet hours (21:00–08:00 their time); one-click
  unsubscribe; sent through the existing email module with a duplicate-
  proof key (Hard Rule 5). The email does not say what the conversation
  was about.
- **P2.3** Two-minute reflection page; it closes the moment and adds a
  note the coach sees next time.
- **P2.4** Helpful / not helpful on replies, stored with the prompt
  version and model so versions can be compared.
- **P2.5** Background job runner (built early, in Phase 1): runs inside
  the existing server, uses the existing database, never runs a job twice,
  retries failures, and can never break a chat turn.
- **P2.6** Optional weekly question by email from the existing
  daily-prompts library.
- **Done when, as tested:** `tests/moments/close-the-loop.test.ts` (6) — a
  leader in Chicago prepares on Tuesday for a Thursday 2pm conversation;
  nothing is sent Thursday night; exactly one email goes out Friday 09:00
  Chicago time (running the job again sends nothing more); the reflection
  is saved; the next session's prompt contains the reflection. Also
  `email-guards.test.ts` (7: opt-in, weekly cap, duplicate key, quiet hours
  in Nairobi, signed and forged unsubscribe links, a link scanner opening
  the link does not unsubscribe, the one-click unsubscribe Gmail sends
  works, the exact request to Resend), `ratings-nudge.test.ts` (5), web `moments/reflect.test.tsx` (1).

### Phase 3 — Hogaan MCP server

(MCP, "Model Context Protocol", is the standard way for an AI assistant to
use another service's tools.)

- **P3.1** An MCP server inside the existing app at `/mcp`. A leader
  connects their assistant with a key they create on their Profile (stored
  only in scrambled form, shown once, revocable). Requires the paid plan
  once billing is on (D6) and uses the existing rate limiter.
- **P3.2** Six tools: get the leader's context, coach (runs Hogaan's own
  coach, saved as a normal session), short practice guidance, log a moment,
  log an outcome, save a note.
- **P3.3** Three ready-made prompts: prepare for my next meeting, review
  the tone of this draft, help me manage up.
- **P3.4** Every tool call writes an audit record first; if that fails, the
  tool refuses. Every write goes through the same privacy filter.
- **Done when, as tested:** `tests/mcp/mcp-server.test.ts` (6) uses the
  official MCP client over a real network connection: the "assistant"
  passes a meeting it read from a calendar, logs it, asks Hogaan to coach,
  gets Hogaan's reply built from Hogaan's prompt and the leader's stored
  context (with the colleague's surname and email stripped), and the
  moment appears in the app. `audit-fail-closed.test.ts` (1).
- Checked current official docs for the MCP SDK before writing it.

### Phase 4 — payments and the free tier

- **P4.1** Stripe subscriptions (test mode only): Stripe-hosted checkout,
  Stripe's customer page for cancelling, and a webhook (Stripe's
  notification to us) that is only accepted with Stripe's signature, each
  notification processed once. Built from Stripe's current guide and SDK.
- **P4.2** One module decides who may use what.
- **P4.3** Free: same coach and memory, 3 new sessions a month, no
  follow-ups, no assistant connection, no meeting notes. Continuing an
  existing session is never blocked.
- **P4.4** Friendly upgrade messages at the session limit and next to
  follow-ups; a Plan card on Profile.
- **Done when, as tested:** `tests/billing/plan-lifecycle.test.ts` (9):
  Free (3 sessions then refused; assistant connection refused) → signed
  "checkout completed" and "subscription active" notifications → Personal
  (limits lifted; a repeated notification ignored) → signed "subscription
  deleted" → Free again; a wrongly signed notification is rejected; with
  billing off nothing is limited; a late, older notification cannot
  revive a cancelled plan; an unpaid checkout or a different product grants
  nothing. **This used correctly signed simulated
  notifications, not a real Stripe test card** (section 3).

### Phase 5 — organizations, cohorts, impact reporting

- **P5.1** Organizations, cohorts with a seat limit, invite codes, and
  members. A seat in an active cohort of a **verified** organization gives
  the "Sponsored" plan (Hogaan staff verify a sponsor with
  `scripts/verify-org.ts`; see section 5).
- **P5.2** The metric glossary, each metric defined once in the database:
  coaching session, active leader, moment prepared, loop closed,
  self-reported outcome, practice coverage, confidence change, and
  helpful rate by prompt version.
- **P5.3** Sponsor report page, CSV download, and a print-to-PDF layout.
  **The 10-person privacy floor is enforced inside the database view
  itself**, so no future screen or query can skip it. It counts only
  leaders who have actually used Hogaan since joining, never the sponsor's
  own staff, and only for verified sponsors.
- **P5.4** Before joining, a leader sees and must accept a plain list of
  what a sponsor can and cannot see. They can leave any time.
- **Done when, as tested:** `tests/orgs/cohort-report.test.ts` (10): a
  50-seat cohort, invite code, 50 leaders join and the 51st is refused, the
  sponsor's report and CSV contain no ids, names, emails, session titles,
  moment text or reflection text; a 9-person cohort returns nothing,
  checked both through the app and directly against the database view; a
  non-sponsor gets nothing; leaving frees the seat; a sponsor cannot join
  its own cohort; an unverified sponsor grants no seat; 10 members of whom
  only 9 used Hogaan still gives no report.

### Phase 6 — direct connections

- **P6.2** Paste meeting notes, get up to five suggested insights, keep the
  ones you choose. Test `tests/meeting-notes/insights.test.ts` (3) pastes
  notes with a unique marker and then searches **every table in the
  database** for it: not found. It also checks the colleague's surname,
  email and phone never reached the model.

---

## 3. Built but not verified

These exist and pass tests against stand-ins, but have never touched the
real service.

| What | Checked against | Needs |
|---|---|---|
| Live coach on `claude-haiku-5-5`; background work on `claude-opus-5-5` | A stand-in model client that records exactly what would be sent | An Anthropic key; run `pnpm eval:coaching` on both models; measure latency |
| The 3-second turn budget (Hard Rule 1) with the brief and moments reads added | Not measured at all | Staging with real Supabase; compare p99 before/after turning the flags on |
| Prompt caching actually saving money | Request shape checked (cache marker on the founder's text, per-leader text after it) | Real calls; check `cache_read_input_tokens`. Note: Haiku 4.5 only caches prompts over ~4,000 tokens, so the saving appears mainly on Haiku 5.5 |
| Follow-up and weekly emails | The exact request to Resend (headers, duplicate key) checked with a stand-in | A Resend account and a real inbox; check the unsubscribe headers render in Gmail/Outlook |
| Stripe checkout, portal, webhooks | Correctly signed simulated notifications | A Stripe test account: a test card through Checkout, then cancel in the portal |
| MCP server with a real assistant | The official MCP client in a test | A mainstream assistant that accepts custom MCP connectors with a key header |
| New database migrations (0018–0022) on Supabase | Embedded Postgres (PGlite) with every migration | Apply to a staging Supabase project; check the RLS settings and the `metabase_reader` grants on the new views |
| Job runner with two server instances | The "claim" logic is written to be safe; tested in one process | Two Render instances on staging |
| Rate limiting of the MCP server | The existing limiter, with a stand-in | Upstash on staging |

The repo's end-to-end browser suite (`pnpm test:e2e`) could not run in
this environment, before or after my changes: it starts `pnpm dev`, which
exits without real Supabase/Redis/database settings.

---

## 4. Not built

| Item | Why |
|---|---|
| P0.2 staging stack | No accounts or keys were available. `docs/runbooks/staging-stack.md` is the checklist. |
| P0.4 baseline score for the current model; founder sample review | Needs a model key. The harness runs; `pnpm eval:coaching` produces the score in a few minutes. |
| P1.4 knowledge digest content | Hamse-owned (Hard Rule 2). Needs: a curated digest of *The Transformational Leader* and the twelve practices (prose for the prompt, plus short per-practice excerpts for the assistant tool), published as an `approved` `knowledge_digest` library version naming the approver. |
| P1.5 the actual switch to Haiku 5.5 | Blocked on the eval score and latency check above. The switch is one setting (`LLM_CHAT_MODEL`). |
| P3.1 OAuth sign-in for assistants | The MCP standard recommends OAuth for remote servers. Built personal keys instead (simpler, works with assistants that accept a key header). OAuth is the next step before a wide launch. |
| Server-generated PDF of the sponsor report | Used the browser's print-to-PDF; adding a PDF library felt unjustified. |
| P6.1 calendar connection, P6.3 inbox access | The plan builds these "only if Phases 2–3 show demand"; there is no usage data yet. Both also need Google's app verification. Google's current rules: apps using "restricted" scopes need extra review, a yearly security assessment by an approved assessor when the data is stored on servers, and "several weeks". Gmail reading is one of these per Google's scope list (Google's page I read did not list scopes; check the OAuth FAQ before scoping). |
| Anthropic `fallbacks` option (automatic retry on a different model when the model declines) for Opus 5.5 | The installed Anthropic SDK (0.92) doesn't support that option; upgrading the SDK across a major version was out of scope. Declines are handled instead (chat: safe message; background: retried, then failed safely). |

---

## 5. Needs your eyes

Most important first.

1. **What changes on merge even with every flag off.** I tried to make
   merging change nothing, but three things do:
   - **The privacy filter (D2) is always on.** Messages to the model now
     have email addresses, phone numbers and surnames removed. Before, a
     leader's message went to the model exactly as typed. I judged this a
     privacy fix rather than a feature, but it can change what the coach
     sees (for example "Google Docs" becomes "Google", and a leader asking
     about "Mr. Smith" is sent "Mr. [name]"). If you want it behind a flag
     too, it is a one-line change. **Hamse and the repo owner should
     confirm D2 itself**: Hard Rule 3 in `CLAUDE.md` has been rewritten to
     allow work context and first names to reach the model.
   - The prompt is sent in two parts (the founder's text marked for
     caching, then the per-leader text). Same words, same order.
   - Each saved turn now also records which prompt version produced it
     (columns that already existed but were empty).
   The new tables (migrations 0018–0022) are only touched when a flag is
   on, but should still be applied before merging.
2. **Text written by engineering that speaks in Hogaan's name, for Hamse
   to review or replace** (Hard Rule 2). Each is marked in the code:
   - the two sentences that introduce the brief to the coach, and the line
     telling the coach it may ask about a missing role or team
     (`src/leader-context/render.ts`);
   - the line telling the coach to ask when an upcoming conversation
     happens (`src/moments/store.ts`);
   - the instructions to the background model for updating the brief and
     for meeting notes (`src/leader-context/updater.ts`,
     `src/meeting-notes/extract.ts`);
   - the follow-up and weekly email wording (`src/jobs/phase2-handlers.ts`);
   - the MCP tool descriptions and the three ready-made prompts, which
     shape how other companies' assistants present Hogaan
     (`src/mcp/server.ts`);
   - the "what a sponsor can and cannot see" statement (`src/orgs/store.ts`).
3. **The knowledge digest content** (section 4) and a **founder review of
   a sample of eval results** once a model key is available.
4. **Before switching to Haiku 5.5:** it "thinks" by default, which may add
   delay before the first word. I set effort to "low" and left more room in
   the length limit, per the official guide. Measure against the 3-second
   rule before switching.
5. **Pricing defaults (D1):** $20/month Personal; Free = 3 new sessions per
   calendar month (UTC). Leaders whose payment is failing ("past due") keep
   Personal while Stripe retries; you may prefer to cut access sooner.
6. **Departures from the plan:**
   - P4.2 said to reuse the rate limiter for the free-tier session cap. I
     count sessions in the database instead: a rate limiter counts attempts
     (a retried request would use up a session), resets on a rolling window
     instead of the calendar month, and needs Redis in demo mode.
   - P2.5 (job runner) was built in Phase 1 because the brief updater
     needed it.
   - P3 uses personal keys instead of OAuth (section 4).
   - Moments are found by the background update after the session, not by
     the coach mid-conversation. The coach is told to *ask* when something
     happens; the date is picked up afterwards or set on the Moments page.
7. **Who may create a sponsor organization, and who verifies it.** Any
   signed-in person can create one, but it does nothing (no free seats, no
   report) until Hogaan staff verify it with `scripts/verify-org.ts`. You
   need to decide who does that vetting, and whether verification should
   also require payment from the sponsor (the plan's "by grant or purchase").
   Residual privacy risk: a verified sponsor willing to create 9 real,
   active fake accounts could still isolate one leader in a report. Vetting
   sponsors is the only control for that.
8. **Known limits of the surname filter.** It catches "First Last"
   (including O'Brien, McDonald, and non-English letters), titles
   ("Dr. Patel") and the leader's own surname. It misses a surname used
   alone without a first name or title ("Johnson said no"), unless it is the
   leader's own.
9. **A gap that existed before this work:** `pnpm typecheck` does not check
   the browser code in `web/` at all. Running it there shows existing type
   errors in older web test files. I checked all new and changed web code
   separately (`npx tsc -p web/tsconfig.json --noEmit`, no errors outside
   the old test files). Worth adding to CI.
10. The follow-up email deliberately does not mention what the conversation
    was about (inboxes are not private). Hamse may prefer otherwise.

11. **An independent security review found real bugs, now fixed.** After
    the build, a separate reviewer (another AI agent given only the code,
    not my conclusions) read the sensitive parts. What it found, and what I
    did:
    - **Anyone could give themselves the paid plan** by creating an
      organization and sponsoring themselves (with billing and orgs both
      on). Fixed: organizations must be verified by staff; sponsors cannot
      join their own cohorts.
    - **The 10-person privacy floor could be gamed with empty accounts.**
      Fixed as far as code can: only verified sponsors, sponsor staff
      excluded, and only members who have used Hogaan count. Residual risk
      in item 7.
    - **One-click unsubscribe from Gmail/Yahoo would have failed**, and
      **opening the link alone unsubscribed people** (corporate link
      scanners open every link). Fixed: the link shows a confirmation
      button; the mail providers' one-click request works.
    - **Stripe:** a failed update was recorded as done (lost for good), and
      notifications arriving out of order could set the wrong plan. Fixed:
      one transaction; older notifications ignored; unpaid checkouts and
      other products grant nothing.
    - **The background brief update could undo a leader's deletion** made
      while it was running. Fixed: it only writes if nothing changed since it
      read the brief.
    - Smaller fixes: jobs re-run when new messages arrive mid-update; a
      healthy long job is no longer mistaken for a crashed one; a recurring
      "1:1 with my director" on a new date is a new moment; the surname
      filter handles O'Brien, McDonald and non-English letters; demo mode is
      refused on staging.
    - **Not fixed (documented):** the 2-emails-a-week cap is checked, then
      claimed, so two server instances sending at the same instant could
      exceed it. Low risk with one instance; fix with a database lock if
      you run several.
    Most fixes have a test (named in section 2). Two were checked by
    reading the code only: the Stripe single-transaction change and the
    job-runner timing changes.

---

## 6. Risk audits (G4.5)

Required for anything touching sign-in, the database schema, personal
data, or `src/libraries/`. Columns follow `CLAUDE.md`. "Evidence" names
what I actually ran; where there is none, the control is marked as a hope.

### Demo mode (touches sign-in)

| Risks | Implications | Audit objectives | Audit procedures | Audit questions | Audit evidence | Control recommendations |
|---|---|---|---|---|---|---|
| Demo sign-in reachable in production or staging | Anyone could act as a user without a password | Demo path cannot run unless `NODE_ENV` is development or test | Unit tests of the config loader, launcher and the sign-in function | Can any setting combination enable it outside a laptop? | `tests/demo/demo-refusal.test.ts` (6 pass); independent review found no bypass | Keep `DEMO_MODE` out of Render's environment; consider an alert if it is ever set |
| Demo sign-in accepts more than one identity | Cross-user access in demo | Only the seeded sample leader | Wrong-token test | Does any other token work? | `demo-server.test.ts` "rejects any other token" | — |
| Demo talks to real services | Real emails or charges from a demo | Demo strips real-service settings | `prepareDemoEnv` test | Are Stripe/Resend/DB settings removed? | `demo-refusal.test.ts` | — |
| Demo skips the audit log | Silent gap in Hard Rule 3 audit | Demo still writes audit rows | Count audit rows around a request | — | `demo-server.test.ts` audit test | — |

### Phase 1 (schema, personal data, `src/libraries/` mechanism)

| Risks | Implications | Audit objectives | Audit procedures | Audit questions | Audit evidence | Control recommendations |
|---|---|---|---|---|---|---|
| Brief stored readable | Breach exposes leaders' notes | Every brief field encrypted | Read raw table after writes | Is any plaintext in `leader_briefs`? | `brief-routes.test.ts` "stores ciphertext only" | Key rotation is still unimplemented (pre-existing) |
| Surname / email / phone reaches the model | Breaks D2 / Hard Rule 3 | Filter on every provider call | Inspect every request a stand-in model receives | Any path around the filter? | `second-session.test.ts` D2 test; `pii/filter.test.ts` | Hamse + owner confirm D2; add a weekly sample check of `prompt_logs` |
| Filter misses a lone surname | Some surnames reach the model | Known limit is documented | Unit tests of edge cases | — | `filter.test.ts` (documents what is caught) | Accept, or add a named-entity model later |
| Private session content leaks into the brief | Breaks the private-mode promise | Private sessions never enqueue or write | Private turn then run jobs | Does the brief version change? | `second-session.test.ts` private test | — |
| Updater overwrites what the leader wrote | Leader loses control (P1.3) | Leader lines and fields are never rewritten, including edits made while the update runs | Merge-rule test; stale-version write test | — | `brief-routes.test.ts`, `concurrency.test.ts` | — |
| Background update slows chat | Breaks Hard Rule 1 | Never in the chat turn | Code review; job runs after `end` | Is anything awaited before the reply? | Code only (`enqueueJobSafe` is fire-and-forget) | **Hope, not control** until latency is measured on staging |
| Unapproved digest text reaches the prompt | Hard Rule 2 | Only `approved` with a named approver | Assembly test with placeholder and approved digests | — | `knowledge-digest.test.ts` | Hamse publishes the digest |
| Migration 0018 rollback deletes briefs | Data loss | Rollback documented as destructive | Read migration header | — | Header comment | Back up before rollback |

### Phase 2 (schema, personal data, email)

| Risks | Implications | Audit objectives | Audit procedures | Audit questions | Audit evidence | Control recommendations |
|---|---|---|---|---|---|---|
| Email without consent | Trust and legal risk | Opt-in only | Send with no opt-in | — | `email-guards.test.ts` | — |
| Too many emails | "Nagging" | ≤ 2 per 7 days, quiet hours | Cap and timezone tests | — | `email-guards.test.ts` | — |
| Duplicate email on retry | Hard Rule 5 | One send per key | Re-run job; repeat key | — | `close-the-loop.test.ts`, `email-guards.test.ts` | Confirm Resend honours `Idempotency-Key` on staging |
| Forged unsubscribe link | Someone unsubscribes others | Signed, purpose-bound link | Forged-token test | — | `email-guards.test.ts` | Set `EMAIL_LINK_SECRET` separately from the encryption key |
| Link scanners unsubscribe people; provider one-click fails | Leaders silently lose check-ins, or can't stop them | GET only confirms; form-encoded POST works | Scanner GET and one-click POST tests | — | `email-guards.test.ts` | Check in Gmail on staging |
| Cap exceeded across instances | More than 2 emails a week | — | Not tested | — | **None (hope)** | Database lock per leader if running several instances |
| Email reveals private content | Inbox is not private | Email omits the moment's subject | Assert body | — | `close-the-loop.test.ts` | Hamse decides wording |
| One leader rating another's turn | Data integrity | Ownership check | Foreign-turn test | — | `ratings-nudge.test.ts` | — |

### Phase 3 (sign-in for assistants, personal data)

| Risks | Implications | Audit objectives | Audit procedures | Audit questions | Audit evidence | Control recommendations |
|---|---|---|---|---|---|---|
| Stolen key gives access | Someone reads a leader's brief | Keys hashed, revocable, last-used shown | Wrong and revoked key tests | — | `mcp-server.test.ts` | Add key expiry; move to OAuth before wide launch |
| Unaudited tool use | Hard Rule 3 audit gap | Audit first, fail-closed | Failing audit writer | Does the tool still act? | `audit-fail-closed.test.ts` | — |
| Assistant writes raw email text into Hogaan | Stores other people's data | Writes filtered; tool text asks for insights only | Save a note with a surname and email | — | `mcp-server.test.ts` PII test | — |
| Framework text handed out too freely (D6) | Founder IP | ≤ 2 excerpts × 600 chars, approved digest only, paid plan, rate limited | Guidance output test; capability test | — | `mcp-server.test.ts`, `plan-lifecycle.test.ts` | Hamse sets D6 limits |

### Phase 4 (schema, payments)

| Risks | Implications | Audit objectives | Audit procedures | Audit questions | Audit evidence | Control recommendations |
|---|---|---|---|---|---|---|
| Forged "paid" notification | Free upgrade | Signature checked on the raw body | Wrong-secret test | — | `plan-lifecycle.test.ts` | Use a separate webhook secret per environment |
| Repeated notification | Wrong state | Each event once, atomically with the change | Repeat event id | Is a failed update retried? | `plan-lifecycle.test.ts` (repeat); transaction by code review | Watch Stripe's failed-delivery dashboard |
| Out-of-order or wrong-product notification | Wrong plan | Older events ignored; paid checkout and Personal price only | Late-event, unpaid, wrong-price tests | — | `plan-lifecycle.test.ts` | Set `STRIPE_PRICE_PERSONAL` in every environment |
| Card data stored | PCI scope | Never stored (Stripe-hosted pages) | Schema review | — | `drizzle/0021` has no card fields | — |
| Limits change behaviour on merge | Users blocked unexpectedly | Off means unlimited | Flag-off test | — | `plan-lifecycle.test.ts` | — |

### Phase 5 (schema, aggregate reporting)

| Risks | Implications | Audit objectives | Audit procedures | Audit questions | Audit evidence | Control recommendations |
|---|---|---|---|---|---|---|
| Small-group report identifies people | Breaks "private, always" | Floor of 10 active leaders in the database, verified sponsors only, sponsor staff excluded | 9-person cohort via app and direct SQL; 10 enrolled / 9 active | Can any route bypass the view? Can fake accounts pad a cohort? | `cohort-report.test.ts` | Keep all sponsor reads on `analytics.cohort_report`; vet sponsors (residual risk: real, active fake accounts) |
| Self-sponsoring for a free paid plan | Revenue loss; floor gaming | Seats only from verified orgs; sponsors can't join own cohorts | Unverified-org and self-join tests | — | `cohort-report.test.ts` review-fix test | Decide who verifies sponsors |
| Report contains individual data | Same | Counts only | Search report and CSV for ids, names, titles, text | — | `cohort-report.test.ts` | — |
| Non-sponsor sees a report | Data leak | Admin check | Member asks for report | — | `cohort-report.test.ts` | Decide who may create organizations |
| Leader unaware of sponsor visibility | Consent | Statement shown and acknowledged | Join without acknowledgement | — | `cohort-report.test.ts` | Hamse reviews statement |
| New views readable by `metabase_reader` | Analysts see per-user metric rows | Same masking as existing analytics views | Not checked on Supabase | Are default privileges applied? | **None (hope)** | Check grants on staging |

### Phase 6 (personal data of third parties)

| Risks | Implications | Audit objectives | Audit procedures | Audit questions | Audit evidence | Control recommendations |
|---|---|---|---|---|---|---|
| Transcript stored | Other people's words kept without consent | Notes never persisted | Search every table for a marker | — | `insights.test.ts` | — |
| Transcript logged | Same, in Render/Sentry logs | Body not logged | Route logs at `warn`; Fastify does not log bodies by default | — | Code only | **Hope** until staging logs are checked |
| Names/contacts sent to the model | D2 | Filter before the model | Inspect model request | — | `insights.test.ts` | — |

---

## 7. What it would take to go live

In order. Each step is something a person does; nothing here is automated.

1. **Decisions:** Hamse and the repo owner confirm D2 (the Hard Rule 3
   rewrite), D1 prices, D4 email rules, D5 floor, D6 limits, and who may
   create sponsor organizations. Hamse reviews the text listed in section 5,
   item 2.
2. **Staging accounts** (all separate from production; see
   `docs/runbooks/staging-stack.md`): Supabase project, Upstash Redis,
   Render service, Anthropic key with a spend cap, Resend test domain,
   Stripe **test mode** (product "Hogaan Personal", $20/month price,
   webhook endpoint `/api/billing/webhook`), and two random secrets
   (`ENCRYPTION_KEY_BASE64`, `EMAIL_LINK_SECRET`).
3. **Apply migrations 0018–0022** to the staging database, then the
   library seed and prompt-template publish scripts.
4. **Measure before changing anything:** run `pnpm eval:coaching` on
   today's model for a baseline; have Hamse review a sample.
5. **Turn flags on one at a time on staging**, in this order:
   `FEATURE_LEADER_BRIEF` → (measure turn latency p99) → `FEATURE_MOMENTS`,
   `FEATURE_RATINGS` → `FEATURE_FOLLOWUP_EMAIL`, `FEATURE_WEEKLY_NUDGE`
   (test with a real inbox) → `FEATURE_MCP` (connect a real assistant) →
   `FEATURE_BILLING` (test card through Checkout and the portal) →
   `FEATURE_ORGS` (verify each sponsor with `scripts/verify-org.ts` after
   vetting) → `FEATURE_MEETING_NOTES`. Repeat the demo click-through
   from section 1 at each step.
6. **Model switch (optional):** set `LLM_CHAT_MODEL=claude-haiku-5-5` on
   staging, re-run the eval, measure latency, keep it only if both hold.
7. **Hamse supplies and approves the knowledge digest**; publish it as a
   `knowledge_digest` library version with `status: approved`; then
   `FEATURE_KNOWLEDGE_DIGEST`.
8. **Production** (D7 — the fork is staging only): agree with the upstream
   repo owner how this work moves to `muhsinwarfa/hogaan`, then the repo's
   normal ship and verify gates (G5–G8): pull request, CI, merge, deploy,
   10 minutes of quiet Sentry, p99 ≤ 3 s. Switch Stripe to live keys last.

---

## 8. Changes made after the build, by the reviewing session

A second session re-ran every check on the final commit (typecheck, lint,
484 backend, 89 route and 128 web tests, production build: all passed, matching
section 2), then started `pnpm demo` and clicked through every page on a phone
and a desktop screen. It found no errors, but did find layout and polish
problems, and fixed them:

- **Phone layout.** The demo banner wrapped to two lines and covered the page
  header; it is now one line. Moments rows were truncated and cramped; they now
  wrap and stack on a phone.
- **Form fields.** Inputs on Profile, What Hogaan knows, Moments and Sponsor
  fell back to plain browser styling (the class they used had no style rule).
  They now match the app.
- **Navigation (new).** Moments was only reachable through Profile or a card on
  Home, and its page highlighted the Home tab. It now has its own tab, shown
  only when the moments feature is on. Test:
  `web/src/__tests__/nav/moments-tab.test.tsx` (2).
- **Wording.** "1 messages" is now "1 message". The scripted demo coach no
  longer repeats the "Open loop:" label.
- **Demo data.** The sample leader now has a complete work context, and the
  sample funder has an obviously made-up name.
- **Browser-code typecheck.** Added `pnpm typecheck:web`, fixed the two old
  errors, and added it to CI (item 9 in section 5).

After these changes: typecheck and web typecheck pass, lint passes, backend 484
passed, web 130 passed, and the demo was clicked through again with no errors.
