# 08 — Hogaan MCP Server

**Status:** living contract — update in the same PR that changes this process.
**Last reviewed:** 2026-11-11 (created in the context-and-connections build, P3.1–P3.4).
**Flag:** `FEATURE_MCP` (default off). Built against `@modelcontextprotocol/sdk` 1.32.2.

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

## Each request

```
[POST /mcp (Streamable HTTP, stateless, JSON responses)]
        │  bearer token → user (revoked / unknown → 401)
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

- OAuth 2.1 authorization (the MCP spec's recommended sign-in for remote
  servers). Tokens are the interim; see the build report.
- Testing against a real third-party assistant (none available to the build).

## Key files

`src/mcp/{server,routes,tokens}.ts`, `src/coaching/engine.ts`,
`src/entitlements/index.ts`, `drizzle/0020_mcp_tokens.sql`
