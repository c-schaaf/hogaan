# Runbook: Observability Incident Triage

## How to use this

This is your 3am playbook. You (Muhsin) are on your phone, half-asleep, possibly scared. You don't need to remember anything. Find the recipe that matches the symptom, run it top to bottom, and stop when the thing it told you to watch turns green. Every URL is clickable. Every Axiom query is copy-paste. If a recipe tells you to pull in Claude or call Hamse, do that immediately — don't try to muscle through alone. There is no engineering team behind you; the three escalation paths in this doc are the only ones that exist.

## Glossary

- **P0**: a coaching turn died with a user-visible error. Page-worthy.
- **P1**: degraded but user got a response. Same-day investigate.
- **P2**: a warning to read on Monday.
- **TurnTrace**: one row in Axiom per coaching turn.
- **traceId**: the ID that lets you find one specific turn across Sentry and Axiom.
- **APL**: Axiom's query language. Paste it into the query editor and hit Run.
- **Fingerprint**: Sentry's grouping for errors of the same kind. Two errors with the same fingerprint = same bug.

## The three real escalation paths

1. **Pull in Claude.** Open Claude Code in this repo. One-line summary: "P0 fired at <time>, symptom is X, recipe Y says it might be Z." Claude can read traces, diff recent commits, and propose a fix or rollback.
2. **Call Hamse.** Phone, not text. For: anything voice/library/content related, anything that affects what we tell testers, killing the beta, deciding whether to refund or apologize.
3. **Wait.** For upstream outages (Anthropic, Supabase, Render regional). You cannot fix someone else's data center. Your job becomes: confirm it's upstream, tell the 5 testers, document the timeline.

## Beta-window override (first 4 weeks — pull Muhsin/Claude immediately, no threshold)

During the first 4 weeks of the closed beta, with only 5 testers, normal thresholds don't apply. **Skip straight to "pull in Claude" if any of these happen:**

- Any tester reports the coach acting weird, slow, off-tone, broken, or anything at all.
- Any P0 in Sentry, ever, regardless of count.
- Any failed deploy on Render.
- The Axiom trace pipeline goes silent for more than 15 minutes during expected tester activity.
- You feel something is off but can't say what.

The cost of pulling Claude into a non-incident is 5 minutes. The cost of missing a real incident in front of a hand-picked tester is the beta.

---

## 1. Sentry P0 incident fires

**Symptom:** Sentry SMS/email page. Issue tagged P0. A coaching turn died — the user saw an error message, not a coach response.

**First check:** Open the Sentry issue at https://hogaan-lj.sentry.io/issues/?project=4511331978313728&statsPeriod=30d. Click into the issue, grab the `traceId` tag.

Then paste this into Axiom (https://app.axiom.co/hogaan-df5k/datasets/hogaan), swapping in the traceId:
```
['hogaan']
| where traceId == "PASTE-TRACE-ID-HERE"
```
**This asks Axiom:** show me everything we know about that one failed turn.

Look at `terminalEvent` — that's how the turn died.

**Likely causes:**
- Anthropic Haiku returned an error (5xx, auth, or rate-limit) — go to Recipe 7.
- Supabase Postgres unreachable — check https://status.supabase.com.
- A code change in the most recent deploy is hitting a fail-closed branch.

**Fix:**
1. If the error started within 15 minutes of a deploy: roll back. Go to https://dashboard.render.com/web/srv-d8arufbbc2fs7399vqr0 → Deploys tab → click the previous successful deploy → Redeploy.
2. If `terminalEvent` mentions Anthropic: Recipe 7.
3. If `terminalEvent` mentions database/Supabase: check https://status.supabase.com. If they're up, open https://supabase.com/dashboard and look at the connection pool.
4. Watch the Sentry issue for 10 minutes. If it stops firing, you're done.

**Escalate when:**
- Same error firing more than 5 times in 5 minutes → **pull in Claude**.
- A tester is in-session right now while this is firing → **pull in Claude AND text Hamse** so he can warn the tester directly.
- You can't tell what `terminalEvent` means after 10 minutes of staring → **pull in Claude**.

---

## 2. BetterStack reports the site is down

**Symptom:** BetterStack SMS — "app.hogaanai.com heartbeat missing". The 30-second ping has failed 3+ times in a row.

**First check:** From your phone, open https://app.hogaanai.com. If it loads and you can sign in, the heartbeat is wrong but the site is fine. If it doesn't load, the site is genuinely down.

**Likely causes:**
- Render deploy crashed or is mid-restart (most common).
- Render regional outage (https://status.render.com).
- A single Render instance is wedged but others still serve — partial outage.

**Fix:**
1. Open https://dashboard.render.com/web/srv-d8arufbbc2fs7399vqr0 → Events tab.
2. If you see "Deploy failed" recently: click the previous successful deploy → Redeploy.
3. If the deploy looks healthy but instances look unhealthy: click "Manual Deploy" → "Clear build cache & deploy" to force a fresh container.
4. If https://status.render.com shows a regional outage: this is **wait**. Tell the testers (text or email): "We're down because our host has an outage — should be back within the hour. Will update."
5. Check BetterStack until you see 2 consecutive green pings.

**Escalate when:**
- Site is genuinely down for more than 10 minutes with no obvious cause → **pull in Claude**.
- Render says healthy but pings still fail → **pull in Claude** (silent failure mode).
- It's a Render outage with no ETA → **call Hamse** so he knows what to tell anyone who asks.

---

## 3. Coaching turn latency p99 spikes above 3s

**Symptom:** You noticed p99 > 3000ms in the daily ritual, or a tester said "the coach is slow." This breaches the Hard Rule.

**First check:** Paste this into Axiom (https://app.axiom.co/hogaan-df5k/datasets/hogaan):
```
['hogaan']
| where _time > ago(30m)
| summarize p50=percentile(latencyMs, 50), p99=percentile(latencyMs, 99), turns=count() by bin(_time, 5m)
| order by _time desc
```
**This asks Axiom:** show me how latency has moved in 5-minute buckets over the last half hour.

If p99 is spiking only in the last 1-2 buckets, it's a fresh issue (likely upstream Anthropic). If it's been creeping up all day, it's drift (likely a deploy from earlier today).

**Likely causes:**
- Anthropic Haiku 4.5 is slow upstream (https://status.anthropic.com).
- A recent deploy added work to the prompt-assembly step.
- Render is under load (rare with 5 testers, but check the Render dashboard CPU graph).

**Fix:**
1. Open https://status.anthropic.com. If they're slow, you cannot fix this — it's **wait**. Tell testers if it lasts > 30 minutes.
2. If Anthropic is healthy: look at the Render Events tab for a recent deploy. If one correlates with the latency climb → roll back.
3. If no deploy, no upstream issue: **pull in Claude** with the Axiom query results. Something has changed and you need a second pair of eyes.

**Escalate when:**
- p99 stays above 3000ms for more than 30 minutes → **pull in Claude**. This breaches the product Hard Rule.
- Any tester is actively in-session and complaining about speed → **pull in Claude AND text Hamse**.

---

## 4. Coaching turns are failing but no Sentry page fired

**Symptom:** A tester reports "I sent a message and got an error." But Sentry is quiet.

**First check:** Get the tester's email and approximate timestamp. Paste this into Axiom (https://app.axiom.co/hogaan-df5k/datasets/hogaan):
```
['hogaan']
| where _time > ago(2h)
| where terminalEvent != "success"
| project _time, traceId, userIdHash, terminalEvent, modelUsed, latencyMs, degradationFlags
| order by _time desc
```
**This asks Axiom:** show me every coaching turn in the last 2 hours that did NOT succeed.

**Likely causes:**
- Anthropic returned an error our code handled "gracefully" but the user still saw an error message — Recipe 7.
- A network hiccup between Render and Anthropic dropped the stream mid-response.
- The tester's session got an auth failure (token expired mid-conversation).

**Fix:**
1. Find the matching row in Axiom (filter by approximate timestamp).
2. Read `terminalEvent` and `degradationFlags`. If `degradationFlags.contextFetchPartial = true`, we sent a coaching turn with incomplete context — note for review.
3. If it's a one-off and the tester succeeded on retry: apologize directly, log the traceId, move on.
4. If it's repeating: go to Recipe 7 (treat as Anthropic incident).

**Escalate when:**
- Same tester sees the error twice in a row → **pull in Claude** with the two traceIds.
- More than one tester reports the same thing in 24h → **pull in Claude AND call Hamse** (he decides whether to pause the beta).

---

## 5. A tester says the coach gave a weird response

**Symptom:** Muhsin gets a message — a tester says the coach was off-tone, generic, gave a wrong-feeling answer, or didn't sound like Hogaan.

**First check:** Get the tester's email or approximate timestamp. Paste this into Axiom (https://app.axiom.co/hogaan-df5k/datasets/hogaan):
```
['hogaan']
| where _time > ago(4h)
| where userIdHash == "PASTE-HASH-HERE"
| project _time, traceId, sessionId, modelUsed, libraryVersions, terminalEvent
| order by _time desc
```
**This asks Axiom:** show me every coaching turn this user had in the last 4 hours.

(If you don't have the userIdHash handy, filter by sessionId or just by `_time` around the report.)

**Likely causes:**
- The model gave a bad answer this once — LLMs have bad days.
- The library template version (`libraryVersions.promptTemplates.version`) is stale because a deploy didn't pick up a new version — rare.
- Hamse changed library content and the new voice is landing differently — content decision, not an ops incident.

**Fix:**
1. Save the `traceId` and the actual response text the tester saw.
2. This is **not your call to make**. Voice belongs to Hamse.
3. **Call Hamse** with the traceId and the response text. He decides if it's a real voice problem or a one-off.
4. If Hamse says it's real and there's an ops fix (e.g. a stale library version), do the fix. Otherwise, file it for him to review against `src/libraries/seed/`.

**Escalate when:**
- 2+ similar reports from different testers in a week → **call Hamse**, this is a voice/library issue, not an ops issue.
- Any tester says the coach said something therapy-adjacent or crisis-adjacent → **call Hamse immediately**. Hard Rule 4 violation.

---

## 6. Axiom dataset goes silent — observability is dark

**Symptom:** Axiom shows zero TurnTrace events for more than 5 minutes, but the site is up and Sentry is quiet. You can't see what's happening.

**First check:** From your phone, sign in to https://app.hogaanai.com and send a coaching turn. Then paste this into Axiom (https://app.axiom.co/hogaan-df5k/datasets/hogaan):
```
['hogaan']
| where _time > ago(10m)
| summarize lastEvent=max(_time), count=count()
```
**This asks Axiom:** when's the most recent trace event, and how many came in the last 10 minutes?

If your test turn shows up, the gap was transient and you're fine. If it doesn't, traces are broken.

**Likely causes:**
- Axiom ingest token expired or got rotated — we silently drop traces.
- Axiom is having an incident (https://status.axiom.co).
- A recent deploy broke the code that emits traces.

**Fix:**
1. Check https://status.axiom.co. If they're down, it's **wait**.
2. Open https://dashboard.render.com/web/srv-d8arufbbc2fs7399vqr0 → Environment tab. Confirm `AXIOM_TOKEN` and `AXIOM_DATASET` are still set and non-empty.
3. If a deploy in the last hour correlates: roll back via Render Deploys tab.
4. Even with Axiom dark, **Sentry still pages on P0s.** You're trace-blind, not totally blind.

**Escalate when:**
- Dataset silent for more than 30 minutes with no clear cause → **pull in Claude**. We cannot audit incidents without traces.
- If it stays dark and a tester is mid-session → **pull in Claude AND text Hamse**: we don't know if their experience is healthy.

---

## 7. Anthropic API outage or sustained rate limit

**Symptom:** Sentry shows a spike of Anthropic errors. Axiom shows turns landing with `fallbackPath = 'fast-model'` and `modelUsed = 'llama-3.3-70b'`. **As of SCRUM-F1, the streaming path now falls back automatically to non-streaming Groq Llama when Anthropic's stream-open fails.** Users still get a response — slightly slower (~3000-3700ms instead of streaming), in a less polished voice (Llama < Haiku on Hogaan voice fidelity). They notice the voice more than the latency.

**First check:** Open https://status.anthropic.com. Is this their incident or just us?

**Likely causes:**
- Anthropic upstream outage.
- Our API key hit its rate-limit tier (volume spike).
- API key was rotated and prod env wasn't updated.

**Fix:**
1. If Anthropic status confirms an outage: **fallback should be doing its job.** Run this Axiom query to confirm Groq is serving requests:
   ```
   ['hogaan']
   | where _time > ago(30m)
   | summarize total=count(), fallback=countif(fallbackPath == "fast-model")
   | extend fallbackPct = (fallback * 100.0) / total
   ```
   If `fallbackPct` is climbing (5%+ of recent turns), the fallback is working. **Wait** is the right answer plus a courtesy heads-up: text the 5 testers "Our primary AI provider is having an outage — Hogaan is running on backup right now, so responses may sound slightly different until they're back." Then **call Hamse** so he hears it from you, not a tester noticing the voice shift.
2. If Anthropic is up but we're seeing 429s: open the Anthropic console, check Usage. If we're at the tier ceiling, request a limit increase (usually approved in under an hour).
3. If we're seeing 401/403 (auth errors): the API key is bad. Rotate it in the Anthropic console, update `ANTHROPIC_API_KEY` in https://dashboard.render.com/web/srv-d8arufbbc2fs7399vqr0 → Environment, redeploy.
4. If a recent deploy correlates with the spike (and Anthropic is healthy): roll back. Something we shipped is mis-calling the API.
5. Confirm successful (non-fallback) turns resume before declaring done. Fallback alone is "degraded service," not "resolved."

**Escalate when:**
- Anthropic outage > 1 hour with no ETA → **call Hamse**. He decides whether to email testers a deeper apology or pause the beta.
- Auth errors persist after a key rotation → **pull in Claude**, something in the deploy didn't pick up the new key.
- Any of this happens while a tester is in-session → **pull in Claude AND text Hamse** immediately, regardless of how long it's been.

---

## After every incident

1. Note the timestamps in UTC: when it started, when you noticed, when you fixed it, when you confirmed recovery.
2. Write the root cause in one sentence. If you don't know, write "root cause unknown — symptoms were X."
3. Save the traceId, the Sentry issue link, and the Axiom query you ran to `docs/audit-evidence/incidents/YYYY-MM-DD-<short-slug>/`.
4. If the incident exposed a gap not in the Risk Register, tell Hamse and add it.
5. **If this runbook was unclear or wrong under pressure, fix it before you sleep.** That is the only way it stays sharp for the next 3am.

## Honest gaps you can't fix in the moment (know these going in)

- **No load test has been run yet** (F8). We don't know the real ceiling.
- **No proven backup-restore drill** (F12). Supabase backups exist but haven't been tested end-to-end.
- **No GDPR-complete account deletion** (F6). Deleting a user from public.users leaves their Supabase Auth identity behind.

Closed in earlier PRs (no longer gaps): F1 streaming fallback (Anthropic outages now route to Groq automatically), F2 per-user rate limit (200/day), F3 message length cap (4500 chars).

*Last updated: 2026-05-31.*
