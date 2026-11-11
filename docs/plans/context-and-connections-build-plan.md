# Hogaan build plan: context, connections, proactivity

Written 2026-11-11 for a coding agent working on a **fork** of `muhsinwarfa/hogaan`.
Read `/CLAUDE.md` and `docs/README.md` first; this plan sits on top of them.

## 0. How to use this plan

- Work on the fork only. Open pull requests against the fork's `main`, never against upstream unless the owner asks.
- Never point the fork at production. Use a separate staging stack (own Supabase project, own Upstash database, own Render service, test-mode keys). Migrations in this plan are destructive to roll back.
- Follow the repo's pipeline in its batched form (CLAUDE.md, "Batch gate approvals"): plan package, build package, ship package, verify package. Any phase that touches auth, schema, `src/libraries/`, or PII needs the G4.5 risk audit.
- The repo expects Jira tickets. The fork owner cannot see that Jira. Use the item IDs in this plan (P1.1, P2.3, ...) as ticket keys, in branch names and PR titles: `feat/P1.1-leader-brief`.
- Section 4 lists decisions that belong to people. Each has a default. Build to the default behind a feature flag and keep going; do not block on them, and do not ship them to real users until the owner confirms.
- Each phase is shippable on its own. Finish and verify one before starting the next.
- Things in this plan about third-party products (the MCP spec and SDK, Google's OAuth verification rules, Stripe, model IDs and prices) change. Check current official docs before writing code against them.

## 1. Where things stand (verified by reading the code on 2026-11-11)

Not yet verified: nobody has installed dependencies or run the test suite in this review. The repo's docs claim 385 backend and 124 frontend tests passing as of June 2026. Phase 0 confirms or corrects that.

| Area | State | Evidence |
|---|---|---|
| Web app: signup, onboarding, streaming chat, sessions, profile | Built | `web/src/phases/`, `src/web-api/routes.ts` |
| Long-term memory | **Built but switched off.** Recall is disabled and the writer was never connected. The coach sees only the last 3 turns plus a thin profile. | `src/web-api/routes.ts:228` (`memoryTopN: 0`, `recentTurnsLimit: 3`); no caller of `src/memory/write.ts` |
| Leader profile | Thin: first name, experience band, location, timezone, chosen practices. No title, industry, team, or goals. | `src/shared/db/schema/users.ts` |
| Payments | None. No billing code, no payment dependency. | `package.json` |
| Feedback from users | None. No rating or outcome capture. | — |
| Organizations, cohorts, sponsor reporting | Removed. Tables were dropped. | `drizzle/0009_drop_sponsor_portal_stack.sql` |
| Analytics | A PII-masked `analytics` schema and Metabase setup exist. No metric definitions beyond raw views. | `drizzle/0012_analytics_schema.sql`, `docs/analytics/kpi-queries.sql` |
| Proactive anything | None. Daily prompt content exists but nothing sends it. | `src/libraries/seed/daily-prompts.ts` |
| Background jobs | A Redis queue module exists; check what, if anything, consumes it. | `src/shared/redis/queue.ts` |
| Coaching model | `claude-haiku-4-5`, one streaming call, same model for every user. Groq Llama 3.3 70B fallback. | `src/shared/llm/chat.ts:69` |
| Stale docs | `package.json` description still says WhatsApp. CLAUDE.md says `voyage-3-lite`; code uses `voyage-3`. Check that BPMN 04 says memory is off. | — |

## 2. Product direction

Three sources, in order of authority: the public website, the founder's stated intent, and the fork owner's ideas.

**The website (hogaanai.com) already promises things the code does not do:**

| Promise on the site | In code today |
|---|---|
| "Remembers your context across conversations" | No. Memory is off. |
| "$20/month, cancel anytime" | No billing. |
| "Cohorts of 50–1,000 leaders, by grant or purchase" | No org or cohort model. |
| "Board-ready impact reporting" | No reporting. |
| "Private, always" / "Not a judge keeping score" | Holds today, and constrains everything below. |

**Founder intent (from the owner's call notes):** the audience skews toward young and emerging leaders, including immigrant and diaspora leaders. Keep onboarding simple. Personalization should improve with use. Monetization is individual subscription plus nonprofit sponsorship. A first cohort of about 50 founding users.

**Fork owner's ideas:** borrow the pattern of connect tools → store data → add a meaning layer → keep context about the person and their organization → let agents use all of it, both when asked and proactively. Specific asks: a context layer (the book, the leader, feedback), connections (email, calendar, meeting notes), proactive prep and feedback, a Hogaan MCP server, a free tier, and a view on model choice and self-hosting.

**The position this plan takes:** close the gap between the website and the product first, because those are promises already made to buyers. Then add the context and proactivity that make Hogaan better than a general chatbot. Reach the user's email, calendar, and meeting notes through an MCP server before building direct integrations.

## 3. Principles

1. **Privacy is the brand.** Every feature that reads more about a leader needs an explicit opt-in, a plain statement of what is read and kept, and a way to see and delete it. Nothing an individual says is ever visible to a funder or employer.
2. **Coach, not judge.** Feedback on a completed meeting is framed as reflection the leader asked for, not a score.
3. **Simple first run.** Onboarding stays at four screens. Context is gathered through conversation over time. Connections are optional and offered later.
4. **Speed stays.** The 3-second turn budget (Hard Rule 1) holds for live chat. Anything slow runs in the background, not in the chat turn.
5. **Coaching content belongs to Hamse.** Do not edit `src/libraries/seed/` or add source material without sign-off (Hard Rule 2). Propose content changes as draft PRs.
6. **Not therapy.** Hard Rule 4 stands.
7. **Store insights, not raw data.** When Hogaan sees an email or transcript, keep the derived note ("prefers direct feedback; tense relationship with director"), not the source.

## 4. Decisions for people (defaults let the build continue)

| # | Decision | Who | Default to build against |
|---|---|---|---|
| D1 | Price and tiers. The site says $20; the repo says $9–19; the founder mentioned about $10. | Hamse | Personal $20/month as published. Free tier: 3 coaching sessions a month. |
| D2 | Hard Rule 3 says no personal data beyond first name reaches the model provider. A context layer needs job title, industry, team roles, colleagues' first names, and whatever the leader pastes in. | Hamse, repo owner | Allow work context and first names. Strip email addresses, phone numbers, and surnames before any model call. Rewrite the rule and run G4.5. |
| D3 | Models. See section 7. | Fork owner | Chat: `claude-haiku-5-5`. Background work: `claude-opus-5-5`. |
| D4 | How proactive messages reach people. | Hamse | Email only, opt-in, capped at 2 a week, quiet hours by timezone. |
| D5 | Privacy floor for org reports. | Hamse | Aggregates only, no group smaller than 10, never message content. |
| D6 | How much framework text the MCP server may hand to another company's chatbot. | Hamse | Short excerpts per request, paid tier only, rate limited. |
| D7 | Who owns production accounts, and when fork work merges upstream. | Hamse, repo owner | Fork is staging only. |
| D8 | Additions to the "locked" stack: a payments provider, the MCP SDK, Google APIs. | Repo owner | Treated as approved for the fork. |

## 5. Architecture: four layers

The pattern borrowed from the owner's other platform, adapted. One important difference: that platform stores business numbers, while Hogaan's raw material is mostly private text. So the "warehouse and meaning layer" idea applies to **product and impact metrics**, and the "context" idea applies to **the leader**.

**Layer 1 — Knowledge (shared by everyone).** *The Transformational Leader*, the twelve practices, and any other sources the Hogaan team selects and has the rights to use. Versioned through the existing `library_versions` table.
Recommended form: a curated digest placed at the start of the system prompt and marked for prompt caching. This adds no step to the chat turn, so no latency. Move to search-based retrieval only if the library outgrows what a cached prompt can hold.

**Layer 2 — Leader context (one per user).** Three short living documents per leader, kept as structured text:
- **Profile**: role, industry, organization type and size, team shape, how they like to be coached.
- **Goals**: what they are working on now and which practices it maps to.
- **Notes**: what has worked, what has not, open loops, upcoming moments.

A background job rewrites these after each session using a stronger model. The chat turn just reads them, placed after the cached knowledge block. This replaces per-turn embedding search as the main memory mechanism, which is what was switched off for costing 300 ms. Keep the existing pgvector memory as a secondary way to pull up one specific past conversation.

**Layer 3 — Signals (events over time).** Coaching sessions, moments the leader is preparing for, outcomes they report back, response ratings, and later calendar events and meeting notes. This is the data that makes proactivity and impact reporting possible.

**Layer 4 — Meaning layer (shared definitions).** One glossary of metrics, each defined once in SQL in the `analytics` schema, so the in-app view, the funder report, and any agent all use the same number. Starter set: active leader, coaching session, moment prepared, loop closed (prepared and reported back), self-reported outcome, practice coverage, confidence change.

**Access.** Two doors into the same layers: the web app, and an MCP server so a leader's existing AI assistant can use Hogaan.

## 6. Phases

### Phase 0 — Baseline on the fork (no behavior change)

- P0.1 Install, then run typecheck, lint, backend tests, route tests, web tests, build. Record actual results in the PR. Fix anything broken by five months of dependency drift.
- P0.2 Stand up the staging stack. Document every environment variable and which are test-mode.
- P0.3 Correct the stale docs listed in section 1.
- P0.4 Build a small coaching-quality evaluation set before changing any prompt or model: 30–50 realistic leader messages with a rubric drawn from the site's own claims (asks before it tells, stays on the leader's real situation, draws on a practice, stays out of therapy, leaves the words to the leader). Every later prompt or model change is scored against it. Hamse reviews a sample.

Done when: CI is green on the fork, staging serves a full signup-to-chat flow, and the evaluation set produces a baseline score for the current model.

### Phase 1 — Make "remembers your context" true

- P1.1 Leader brief (Layer 2): schema, encrypted at rest like other PII, background updater after each session, injected into prompt assembly. Update BPMN 02 and 04.
- P1.2 Profile enrichment: title, industry, organization type and size, team shape, current goals. Gathered in conversation ("can I ask what your team looks like?") and editable on the Profile page. Do not add onboarding screens.
- P1.3 "What Hogaan knows about you" page: shows the brief in plain language, lets the leader edit or delete any line or everything. Private sessions never write to it (extend the existing private-mode contract).
- P1.4 Knowledge digest (Layer 1) in a cached system block, built from content Hamse supplies and approves. Until then, restructure only; do not write new framework content.
- P1.5 Model migration per D3, scored on the Phase 0 evaluation set and checked against the 3-second budget.

Done when: a second session, days later, opens with the coach already knowing the leader's role, team, and last open loop; turn latency p99 is unchanged; a test proves no email, phone number, or surname reaches a model call.

### Phase 2 — Close the loop (proactivity and feedback with no integrations)

This is the highest-value step and needs no access to anyone's inbox.

- P2.1 Moments: when a session is about something upcoming, the coach asks when it happens and stores a moment (what, who by role, when).
- P2.2 Follow-up: after the moment's time passes, send one email, "How did the conversation go?", linking into a short reflection session. All sends go through `src/shared/email/` (Hard Rule 5), with unsubscribe, frequency cap, and quiet hours.
- P2.3 Outcome capture: the reflection records how it went and what the leader would do differently. This updates the Notes document and feeds the metrics.
- P2.4 Response rating: a simple helpful / not helpful on coach replies with an optional note, stored with the prompt version so library versions can be compared.
- P2.5 Background job runner within the existing stack (the Redis queue or a scheduled Render job). Idempotent, traced, fail-open so a job failure never breaks chat.
- P2.6 Optional weekly nudge using the existing daily-prompt content, opt-in.

Done when: a leader who prepares for a Thursday conversation gets one follow-up on Friday, can reflect in two minutes, and the next session's coaching refers to what happened.

### Phase 3 — Hogaan MCP server

A remote MCP server lets a leader add Hogaan to the AI assistant they already use. It is also the cheapest way to deliver "connect to email, calendar, and meeting notes": the leader's assistant already has those connections, so it fetches the meeting or the draft email and asks Hogaan how to approach it. Hogaan never stores the inbox.

- P3.1 Server on the existing Fastify app, signed in with the leader's Hogaan account. Paid tier (D6).
- P3.2 Tools:
  - `get_leader_context` — the brief.
  - `coach` — runs Hogaan's own coaching engine on a situation and returns Hogaan's reply, so the voice and method stay Hogaan's.
  - `get_practice_guidance` — short relevant excerpts of the framework for a situation.
  - `log_moment`, `log_outcome`, `save_note` — write back, so use outside the app still builds context.
- P3.3 Ready-made prompts the assistant can offer: prepare me for my next meeting; review the tone of this draft; help me manage up on this.
- P3.4 Every tool call audited; writes go through the same PII filter as the app.

Done when: from a mainstream assistant with a calendar connection, "prep me for my 2pm" returns coaching in Hogaan's voice that uses the leader's stored context, and the moment appears in the Hogaan app.

### Phase 4 — Payments and the free tier

- P4.1 Subscription billing in test mode: Free, Personal, Sponsored seat.
- P4.2 Entitlements checked in one place, reusing the existing per-user rate limiter for the free-tier session cap.
- P4.3 Free tier limits sessions, not quality. Free users get the same coach and memory, 3 sessions a month, no follow-ups, no MCP, no connections. Model cost per free user is cents, so the limit exists to give a reason to upgrade, not to save money.
- P4.4 Upgrade prompts at natural points (session cap reached, first follow-up offered).

Done when: a test card moves an account Free → Personal → cancelled, and limits follow.

### Phase 5 — Organizations, cohorts, and impact reporting

- P5.1 Reintroduce organizations, cohorts, memberships, and invite codes (new design; do not restore the dropped tables as they were).
- P5.2 The metric glossary (Layer 4) as SQL views with tests.
- P5.3 Funder report: enrollment, activity, practices worked on, loops closed, self-reported outcomes, as a page and a PDF/CSV export. Enforce D5 in the query layer, with a test that a 9-person cohort returns nothing.
- P5.4 The leader sees a plain statement of exactly what their sponsor can and cannot see.

Done when: a 50-seat test cohort can be invited by code and its sponsor sees a report with no individual data.

### Phase 6 — Direct connections (only if Phases 2–3 show demand)

- P6.1 Calendar, read-only, for leaders who do not use an AI assistant: a prep email the evening before a meeting the leader has flagged.
- P6.2 Meeting notes by paste or upload into a reflection session. Keep the insights, discard the transcript.
- P6.3 Direct inbox access comes last, if ever. Reading mail typically triggers a provider security assessment that costs money and takes weeks, and it is the feature most at odds with "private, always". Check current provider rules before scoping.

## 7. Model, MCP, and self-hosting: the reasoning

**What runs Hogaan today.** One model for everyone: `claude-haiku-4-5`, called through Hogaan's own server code, which assembles the prompt from the framework, the profile, and recent turns. A useful distinction: the *model* is the AI that writes the reply; the *harness* is the software around it that decides what the model sees. Hogaan's value is in the harness and the content, not in which model it rents.

**Recommended models.**
- Live chat stays on the fastest tier because of the 3-second rule. Move to the current generation, `claude-haiku-5-5`, listed at $0.10 input / $0.50 output per million tokens against $1 / $5 for the model in use. This is a migration, not a rename; follow the official migration guide and re-score on the evaluation set.
- Background work has no latency limit, so use a stronger model there: `claude-opus-5-5` ($4 / $20) for updating the leader brief, writing reflections, and prep notes. `claude-sonnet-5-5` ($2 / $10) is the cheaper step-down if the owner prefers.
- Rough cost, assuming about 4,000 tokens in and 300 out per chat turn: about $0.0006 a turn on Haiku 5.5, so a leader doing 100 turns a month costs about 6 cents. The same turn on Opus 5.5 would be about 2 cents, or roughly $2 a month. Either is small against a $20 price. These are estimates; measure from `prompt_logs` in Phase 0. If the owner would rather trade some speed for a stronger coach in live chat, that is affordable; it is a latency decision, not a cost one.

**Should users pick or bring their own model?** Not inside the app; it adds a settings screen for an audience that wants simplicity and makes quality impossible to guarantee. The MCP server is the bring-your-own-model route: the leader's own assistant does the talking and Hogaan supplies method and memory.

**Self-hosting.** Not now. Renting a machine able to run a capable open model costs on the order of thousands of dollars a month whether one person uses it or a thousand, against cents per user for an API. It needs an engineer to keep it running, and the team has none. Quality would also drop below the current coach. The real concern behind the idea is usually data privacy, and that is better met by the provider's data-retention terms, and for enterprise buyers by serving the same models through the buyer's own cloud account. Revisit at thousands of daily active users or if a buyer contractually requires it.

## 8. Risks to keep in view

- Meeting notes and emails contain other people's information, and those people did not agree to anything. Keep derived notes only, and tell the leader so.
- Proactive messages become nagging quickly. Start with one follow-up per moment and let leaders turn it down or off.
- The MCP server sends framework text to other companies' assistants. That is Hamse's intellectual property; D6 controls how much.
- Sponsor reporting and "private, always" pull against each other. The minimum group size and the plain-language disclosure are what hold them together.
- The fork will drift from upstream. Agree with the repo owner early how and when work goes back.

## 9. Out of scope for this plan

Voice coaching, WhatsApp, native mobile apps, certification, the separate performance-review product, model fine-tuning, and any change to coaching content not approved by Hamse.

## 10. Kickoff prompt for the building agent

> You are working on my fork of the Hogaan repo. Read `CLAUDE.md`, `docs/README.md`, and `docs/plans/context-and-connections-build-plan.md` in full before doing anything. Start with Phase 0 only. Use the plan's item IDs as ticket keys. Build against the defaults in section 4 behind feature flags. Do not touch `src/libraries/seed/` content, do not connect to any production service, and do not open pull requests against the upstream repo. When Phase 0 is done, give me the actual test results, what you fixed, and your plan package for Phase 1, then wait for my go.
