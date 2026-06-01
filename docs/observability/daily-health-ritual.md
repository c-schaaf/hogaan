# Hogaan — Daily/Weekly Health Ritual

## How to use this

This is your morning coffee checklist. You (Muhsin) open it once a day, run five quick checks, and either close the tab or follow the link to the matching incident recipe. You do not need to understand the codebase to run this. You do not need to be awake. If anything is yellow or red, the runbook (`docs/runbooks/observability-incident-triage.md`) tells you what to do. Five minutes, every weekday morning. Fifteen minutes on Monday.

## Glossary (only the unavoidable terms)

- **P0**: a coaching turn died with a user-visible error. Page-worthy. Drop everything.
- **P1**: something degraded but the user still got a response. Investigate today, not tonight.
- **P2**: a warning we want to see in aggregate. Read on Monday, not at 3am.
- **TurnTrace**: one row in Axiom per coaching turn. Has `traceId`, `latencyMs`, `terminalEvent`, etc.
- **terminalEvent**: how the turn ended (`success`, `llm_error`, `auth_failed`, etc.).
- **APL**: Axiom's query language. You paste it; Axiom runs it. No coding needed.
- **Heartbeat**: a ping the server sends BetterStack every 30 seconds to prove it's alive.

---

## DAILY (5 min)

### 1. Sentry — overnight errors

**Where:** https://hogaan-lj.sentry.io/issues/?project=4511331978313728&statsPeriod=30d

**Filter the list:** "Last 24 hours" + sort by "Events".

**Threshold (beta calibration — 5 testers, ~50 turns/day):**
- **Any P0 ever** → incident. Go to Recipe 1.
- **Any P1 that mentions a tester's name or session** → incident. Go to Recipe 1.
- **Two P1s with the same fingerprint (same error title) in 24h** → investigate today.
- Single one-off P1 with no tester impact → note it, move on.

---

### 2. BetterStack — is the site actually up

**Where:** https://uptime.betterstack.com/team/t536506/incidents

**Look at:** all monitors green, no missed heartbeats in the last 24h.

**Threshold:**
- Any monitor red → Recipe 2.
- More than 2 missed heartbeats on one instance → Recipe 2 (silent failure — the site looks up but isn't).

---

### 3. Axiom — turn latency p99 (last 24h)

**Where:** https://app.axiom.co/hogaan-df5k/datasets/hogaan

**Paste this into Axiom:**
```
['hogaan']
| where _time > ago(24h)
| where terminalEvent == "success"
| summarize p50=percentile(latencyMs, 50), p99=percentile(latencyMs, 99), turns=count()
```
**This asks Axiom:** of every successful coaching turn in the last day, what was the median and the slowest 1%, and how many were there?

**Threshold:**
- **p99 > 3000ms** → breaches the Hard Rule. Recipe 3.
- **p99 between 2500-3000ms** → trending bad. Note it, re-check tomorrow.
- **turns < 20** in a 24h window during the beta → tester engagement is low, not a health problem, but worth telling Hamse.

---

### 4. Axiom — anything failing today

**Where:** https://app.axiom.co/hogaan-df5k/datasets/hogaan

**Paste this into Axiom:**
```
['hogaan']
| where _time > ago(24h)
| where terminalEvent != "success"
| summarize count() by terminalEvent, modelUsed
```
**This asks Axiom:** in the last 24 hours, how many turns ended badly, grouped by the type of failure and which model was being used?

**Threshold:**
- **Any row at all during beta** → open one of the failing `traceId`s, cross-reference with Sentry, decide if a tester saw it. If yes → Recipe 1.
- **SCRUM-F1 update:** the streaming path now falls back to Groq Llama automatically when Anthropic stream-open fails. So a turn with `modelUsed = llama-3.3-70b` and `fallbackPath = fast-model` is NOT a failure — it's a successful degraded response.

---

### 4b. Axiom — fallback rate (Anthropic outage early-warning)

**Where:** https://app.axiom.co/hogaan-df5k/datasets/hogaan

**Paste this into Axiom:**
```
['hogaan']
| where _time > ago(24h)
| where terminalEvent == "Process_2.Step_StreamComplete"
| summarize total=count(), fallback=countif(fallbackPath == "fast-model")
| extend fallbackPct = (fallback * 100.0) / total
```
**This asks Axiom:** of every successful turn in the last 24 hours, what % were served by Groq Llama (because Anthropic was down) instead of Anthropic Haiku?

**Threshold:**
- **Steady state:** 0% — Anthropic should serve every turn when healthy.
- **fallbackPct > 5%** in any 24h window → Anthropic is having problems even if Sentry is quiet. Recipe 7.
- **fallbackPct = 100%** → Anthropic is down. Already in Recipe 7 territory; check Anthropic status.
- **Voice quality note:** Llama is meaningfully less polished than Haiku on Hogaan voice. Testers WILL notice the difference. If fallback rate is sustained, text testers proactively: "Our primary AI provider is having an outage — responses may sound slightly different until they're back."

---

### 5. Axiom — is the trace pipeline alive

**Where:** https://app.axiom.co/hogaan-df5k/datasets/hogaan

**Paste this into Axiom:**
```
['hogaan']
| where _time > ago(1h)
| summarize lastEvent=max(_time), count=count()
```
**This asks Axiom:** when did we last receive a TurnTrace event, and how many came in this hour?

**Threshold:**
- **Last event > 30 min old during normal hours** → Recipe 6 (we are flying blind).
- **count = 0 for the last hour during expected tester activity** → Recipe 6.

**If all five green: close the tab. You're done.**

---

## WEEKLY MONDAY (15 min)

Run the five daily checks first, then:

### 6. p99 latency — 7-day trend

**Paste this into Axiom** (https://app.axiom.co/hogaan-df5k/datasets/hogaan):
```
['hogaan']
| where _time > ago(7d)
| where terminalEvent == "success"
| summarize p99=percentile(latencyMs, 99), turns=count() by bin(_time, 1d)
| order by _time asc
```
**This asks Axiom:** show me each day this week — the slowest 1% of turns and total turn count.

**Threshold:**
- Any day with **p99 > 2800ms** (within 200ms of the Hard Rule) → file a ticket. Don't wait for the breach.
- p99 climbing every day in a row → file a ticket even if today is fine.

---

### 7. Sentry — weekly P1 review

**Where:** https://hogaan-lj.sentry.io/issues/?project=4511331978313728&statsPeriod=7d

**Filter:** Level = warning, 7 days.

**Threshold (beta calibration):**
- Any single fingerprint with **3+ occurrences this week** → triage Monday afternoon. Recurring P1 is a latent P0.
- Anything tester-attributable that you hadn't already seen → call Hamse before the tester does.

---

### 8. Axiom — turn volume sanity

**Paste this into Axiom** (https://app.axiom.co/hogaan-df5k/datasets/hogaan):
```
['hogaan']
| where _time > ago(7d)
| summarize turns=count() by bin(_time, 1d)
| order by _time asc
```
**This asks Axiom:** how many coaching turns did we serve each day this week?

**Threshold:**
- Any day **< 50%** of the 7-day median → either traces broke (Recipe 6) or testers stopped using it (tell Hamse).
- Any day **> 200%** of median → either great news or a runaway log loop. Open a few `traceId`s and check.

---

### 9. Render — deploy + restart sanity

**Where:** https://dashboard.render.com/web/srv-d8arufbbc2fs7399vqr0

**Look at:** Events tab — list of deploys and instance restarts.

**Threshold:**
- More than 2 unexplained restarts in 7 days → pull in Claude, investigate.
- Any failed deploy you don't remember triggering → pull in Claude immediately.

**If all four weekly checks green: ship the week.**

---

## Honest gaps (so you remember them under pressure)

- **No load test has been run** (F8). We don't know the real turn-volume ceiling. If volume spikes, you are in unknown territory.
- **No proven backup-restore drill** (F12). Supabase backups exist but haven't been test-restored.
- **No GDPR-complete account deletion** (F6). The Supabase Auth identity is left behind when a user deletes their account.

Closed in earlier PRs (no longer gaps): F1 streaming fallback (Anthropic outages now route to Groq automatically — see Check 4b above), F2 per-user rate limit (200/day), F3 message length cap (4500 chars).

*Last updated: 2026-05-31.*
