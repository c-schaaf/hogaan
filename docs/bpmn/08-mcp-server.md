# 08 — Hogaan MCP Server

**Status:** living contract — update in the same PR that changes this process.
**Last reviewed:** 2026-11-17 (P3.1b "Sign in with Hogaan" added; created 2026-11-11 in the context-and-connections build, P3.1–P3.4).
**Flags:** `FEATURE_MCP`, and `FEATURE_MCP_OAUTH` for sign-in (both default off). Built against
`@modelcontextprotocol/sdk` 1.32.2 and the MCP authorization spec, 2026-07-28 revision.

## Purpose

Let a leader add Hogaan to the AI assistant they already use. Their
assistant already has their calendar and email; it fetches the meeting or
draft and asks Hogaan how to approach it. Hogaan never stores the inbox.

## Connect (P3.1)

```
[Profile → "Use Hogaan from your AI assistant" → Connect]
        │  POST /api/mcp/tokens  (requires the `mcp` capability — D6: paid tier)
        │  token = hgn_<32 random bytes>; store SHA-256 only; show once
        ▼
[leader pastes server URL + "Authorization: Bearer hgn_…" into their assistant]
```

## Connect by signing in (P3.1b, OAuth 2.1)

The leader pastes only `https://<host>/mcp` into their assistant and clicks
Connect. Hogaan is both the authorization server and the protected resource.

```
[assistant] POST /mcp, no token
        │  401  WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp"
        ▼
[assistant] GET  /.well-known/oauth-protected-resource/mcp      (RFC 9728)
            GET  /.well-known/oauth-authorization-server         (RFC 8414)
        ▼
[assistant] identifies itself, one of:
        │  Client ID Metadata Document: client_id is an https URL; Hogaan fetches it
        │    (SSRF-guarded: https/443, public addresses only, pinned, 5 s, 64 KB, no redirects)
        │  Dynamic Client Registration: POST /oauth/register → client_id = signed details
        │    (stateless: survives a demo restart). Public clients only, PKCE required.
        ▼
[leader's browser] GET /oauth/authorize?client_id&redirect_uri&code_challenge(S256)&state&resource
        │  unknown client or unregistered return address → error page, NO redirect
        │  other problems → redirect back with error= (invalid_request, invalid_target …)
        │  ok → 302 /connect-assistant?req=<signed request, 15 min>
        ▼
[consent screen in the app] the leader's normal sign-in (Supabase; demo: the access code)
        │  GET  /api/oauth/request  → assistant name, return host, plan allowed?
        │  POST /api/oauth/consent {approve}
        │     Cancel → redirect error=access_denied
        │     no `mcp` capability → 402 (no code)
        │     audit_log row MCP_OAUTH_CONSENT FIRST, fail-closed (503 if it cannot be written)
        │     → redirect with code (signed, 5 min, bound to client, return address,
        │       PKCE challenge, resource) + state + iss
        ▼
[assistant's server] POST /oauth/token  grant_type=authorization_code + code_verifier
        │  creates the grant row (mcp_oauth_grants); code_jti unique → a code works once;
        │  a reused code revokes the grant it created
        │  → access token (1 h, audience = <host>/mcp) + refresh token (60 days)
        ▼
[assistant] POST /mcp  Authorization: Bearer hgo_…
        │  signature, expiry, audience, then the grant row (revoked → 401 at once)

Refresh: POST /oauth/token grant_type=refresh_token → rotated every time.
  Reuse of a replaced refresh token → grant revoked (theft), except within
  60 s of the rotation (a network retry: refused, grant kept).
Revoke: Profile "Disconnect" (DELETE /api/mcp/connections/:id) or POST /oauth/revoke.
```

**Demo mode only:** the database is rebuilt on every restart. A valid,
signed token whose grant row is missing recreates the row for the sample
leader (the only person a demo token can name). Consequence: a demo
"Disconnect" lasts until the next restart. Needs `MCP_OAUTH_SECRET` set so
tokens stay valid across restarts. In the real app a missing row means no
connection.

**Access gate (hosted demo):** open without the access code: the two
metadata documents, `/oauth/register`, `/oauth/token`, `/oauth/revoke`
(called by the assistant's servers, no browser). `/oauth/authorize` and the
consent screen stay behind the gate; the gate's form carries the authorize
request through.

## Each request

```
[POST /mcp (Streamable HTTP, stateless, JSON responses)]
        │  bearer token → user: personal key (hgn_) or sign-in token (hgo_);
        │  revoked / unknown → 401 with the sign-in challenge
        │  capability check (403 when not entitled)
        │  existing per-user rate limiter, key mcp:<userId> (429)
        ▼
[new McpServer bound to that user + new transport, per request]
        ▼
[tool call] → audit_log row (trigger_source 'mcp', MCP_<tool>) FIRST, fail-closed
        │  audit insert fails → tool returns an error and does nothing
        ▼
 get_leader_context   brief + upcoming moments (BPMN 06/07)
 coach                coachOnce(): Hogaan's own prompt assembly + D2 filter + model;
                      saved as a session "Via your AI assistant: …"; brief update queued
 get_practice_guidance  ≤ 2 excerpts × ≤ 600 chars from an APPROVED digest (D6);
                      otherwise the practice names only
 log_moment / log_outcome / save_note   write via the same filtered store functions
```

Prompts offered to the assistant (P3.3): `prep_next_meeting`,
`review_draft_tone`, `manage_up`.

## Not built

- Pre-registered OAuth clients ("Use your own OAuth client" in Claude) and
  confidential clients (client secrets, private_key_jwt). Claude's two
  automatic methods (CIMD, DCR) are public clients and need neither.
- Narrower scopes: one scope, `hogaan`, grants all six tools.
- Testing against a real third-party assistant (none available to the build).

## Key files

`src/mcp/{server,routes,tokens}.ts`, `src/mcp/oauth/{routes,clients,grants,seal}.ts`,
`web/src/phases/ConnectAssistant.tsx`, `src/coaching/engine.ts`, `src/entitlements/index.ts`,
`src/demo/access-gate.ts`, `drizzle/0020_mcp_tokens.sql`, `drizzle/0023_mcp_oauth_grants.sql`
