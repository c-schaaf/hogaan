import { and, desc, eq, gt, ilike, isNotNull, lt, sql as drizzleSql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { fetchCoachingContext } from '../coaching/context-fetch.js';
import { reportP2 } from '../incident-handling/index.js';
import { assemblePrompt, PromptAssemblyError } from '../prompt-assembly/index.js';
import { resolveSession } from '../session-lifecycle/index.js';
import type { Database } from '../shared/db/client.js';
import { decryptPlaintext, encryptPlaintext } from '../shared/db/encryption.js';
import { sessions } from '../shared/db/schema/sessions.js';
import { turns } from '../shared/db/schema/turns.js';
import { users } from '../shared/db/schema/users.js';
import { chat, chatStream } from '../shared/llm/chat.js';
import type { RedisBundle } from '../shared/redis/client.js';
import { checkRateLimit, type RateLimiters } from '../shared/redis/rate-limit.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { emitTurnTrace, type TraceEmitter } from '../shared/trace/index.js';
import {
  asSessionId,
  asUserId,
  type LibraryVersionSet,
  noDegradation,
} from '../shared/types/index.js';
import { createHash } from 'node:crypto';
import { generateSessionTitle } from './session-title.js';
import { requireSupabaseSession } from './supabase-session.js';

/**
 * Per-turn trace identifier. Opaque sha256 prefix of the internal userId —
 * never plaintext PII (Hard Rule #3).
 */
function hashUserId(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 16);
}

/**
 * Placeholder library version set used when a turn fails before prompt
 * assembly resolves real versions. The shape matches LibraryVersionSet so the
 * downstream consumer (Axiom dataset schema) stays stable; the empty version
 * strings let dashboards filter these rows out as "pre-assembly failures".
 */
function emptyLibraryVersions(): LibraryVersionSet {
  return {
    promptTemplates: { version: '', hash: '' },
    voiceRules: { version: '', hash: '' },
    culturalFraming: { version: '', hash: '' },
    resolvedAt: new Date(),
  };
}

export interface WebApiRoutesOpts {
  config: AppConfig;
  db: Database;
  redis: RedisBundle;
  rateLimiters: RateLimiters;
  traceEmitter: TraceEmitter;
}

/**
 * End-user web API routes. All require a valid Supabase session.
 *
 *   POST /api/chat/turn/stream { message, sessionId?, private? } -> SSE
 *   GET  /api/sessions                                           -> grouped session list
 *   GET  /api/sessions/:id                                       -> session + turn history
 *   DELETE /api/sessions/:id                                     -> hard delete (cascades to turns)
 *   GET  /api/profile                                            -> profile snapshot
 *   PATCH /api/profile        { mappedPractices?, commStyle?, responseDepth?, fullName? }
 *   DELETE /api/profile                                          -> hard delete account + all data
 */
export function registerWebApiRoutes(app: FastifyInstance, opts: WebApiRoutesOpts): void {
  // POST /api/chat/turn/stream ----------------------------------------
  // Streaming variant of /api/chat/turn. Returns Server-Sent Events:
  //   event: start   data: { sessionId }
  //   event: delta   data: { text }            (one per token chunk)
  //   event: end     data: { turnId, sessionId, latencyMs }
  //   event: error   data: { message }         (on any failure mid-stream)
  //
  // Streaming is the only chat path; the legacy non-streaming route and
  // its orchestrator (triage / tagger / QC) were removed in SCRUM-43.
  app.post<{
    Body: { message?: unknown; sessionId?: unknown; private?: unknown };
  }>('/api/chat/turn/stream', async (req, reply) => {
    const session = await requireSupabaseSession(req, reply, opts, 'E1_ChatTurnStream');
    if (session === null) return;

    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (message.length === 0) {
      return reply.code(400).send({ error: 'message_required' });
    }
    // SCRUM-F3: cap user message length. Pre-fix the only check was non-empty,
    // and the Fastify bodyLimit allowed up to 256KB — a single message could
    // inflate per-turn Anthropic token cost by ~9x AND get re-included in
    // prior-turn history on every subsequent turn of the session, compounding
    // the cost. 4500 chars ≈ 700 words at typical English density, which
    // covers any realistic coaching prompt (most are 50-300 words) with
    // generous headroom for pasted context like an email to react to.
    // The user-facing copy is intentionally in Hogaan's first-person voice
    // (no em dashes, contractions, plain language — system-prompt rules) so
    // the chat bubble reads like a gentle nudge from the coach, not an
    // HTTP error from a server.
    if (message.length > 4500) {
      return reply.code(400).send({
        error: 'message_too_long',
        message:
          'That message is longer than I can take in one go. Try trimming it under 700 words.',
      });
    }
    const isPrivate = req.body?.private === true;
    // SCRUM-53: honor the client's sessionId so "Continue past session"
    // attaches the new turn to the named session instead of starting a
    // duplicate one. The resolver validates ownership before reusing.
    const clientSessionId =
      typeof req.body?.sessionId === 'string' && req.body.sessionId.length > 0
        ? asSessionId(req.body.sessionId)
        : undefined;

    const t0 = Date.now();
    const userId = asUserId(session.userId);

    // Hoisted so the catch block can emit a TurnTrace with whatever state was
    // resolved before the failure. See trace emission below.
    let traceSessionId: string | undefined;
    let traceLibraryVersions: LibraryVersionSet | undefined;
    let traceContextPartial = false;

    // SCRUM — per-user + global rate limit on the stream endpoint.
    // The hand-off to reply.hijack() happens *after* this check so we can
    // still return a proper 429 status code with a JSON body if rejected.
    // SCRUM-B5: fail-OPEN on Upstash outage — a rate-limiter throw must not
    // block the chat turn. The Anthropic console spend cap is the
    // compensating control if the limiter is unavailable.
    let rateDecision: Awaited<ReturnType<typeof checkRateLimit>>;
    try {
      rateDecision = await checkRateLimit(opts.rateLimiters, 'web-chat', `web-chat:${userId}`);
    } catch (err) {
      reportP2(
        'rate-limit check failed (fail-open)',
        {
          source: 'Process_2.Step_3.RateLimit',
          extra: { err: err instanceof Error ? err.message : String(err) },
        },
        err,
      );
      rateDecision = { decision: 'PROCEED' };
    }
    if (rateDecision.decision === 'REJECT') {
      // SCRUM-F2: per_user_daily is the only REJECT reason a real user will
      // hit (their own 200/day cap). per_day is the global runaway fuse and
      // should be vanishingly rare — but if it fires, the user-facing copy
      // is intentionally the same ("try again later") because there's
      // nothing actionable they can do either way. Tighten only if user
      // research shows they want the distinction.
      const userMessage =
        rateDecision.reason === 'per_user_daily'
          ? "You've hit today's limit. Try again tomorrow."
          : 'The coach is briefly unavailable. Please try again later.';
      return reply.code(429).send({
        error: 'rate_limited',
        reason: rateDecision.reason,
        message: userMessage,
      });
    }
    if (rateDecision.decision === 'QUEUE') {
      // Streaming + queueing is awkward; surface the back-pressure to the
      // client as 429 with retry-after rather than holding the connection
      // open. The UI can decide to retry after the suggested delay.
      void reply.header('Retry-After', Math.ceil(rateDecision.retryAfterMs / 1000));
      return reply.code(429).send({
        error: 'rate_limited',
        reason: rateDecision.reason,
        retryAfterMs: rateDecision.retryAfterMs,
        message: 'The coach is busy right now. Try again in a moment.',
      });
    }

    // Tell Fastify to stop managing this response — we're going raw for SSE.
    // Without hijack, Fastify can layer Content-Length/serialization on top
    // of our chunked writes and the browser never enters event-stream mode.
    reply.hijack();

    // SSE headers — `reply.raw` lets us write chunks manually.
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Push the headers immediately so the browser enters SSE-receive mode
    // before any data chunks arrive.
    reply.raw.flushHeaders();
    const sendEvent = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // SCRUM-B9: SSE backpressure / client-disconnect cleanup. If the browser
    // closes the connection mid-stream, abort the LLM call so we free the DB
    // pool slot and stop Anthropic billing. Idempotent — abort() on an
    // already-aborted controller is a no-op.
    const streamController = new AbortController();
    let streamCompleted = false;
    req.raw.on('close', () => {
      if (!streamCompleted) streamController.abort();
    });

    try {
      // ---- Session resolution ----------------------------------------
      // Spread the sessionId conditionally — `exactOptionalPropertyTypes`
      // forbids passing an explicit undefined for an optional field.
      const resolved = await resolveSession(opts.db, {
        userId,
        ...(clientSessionId !== undefined ? { sessionId: clientSessionId } : {}),
      });
      const sessionId = resolved.sessionId;
      traceSessionId = sessionId;

      // ---- Context fetch (profile + recent turns + memory) -----------
      const ctx = await fetchCoachingContext(
        { config: opts.config, db: opts.db },
        {
          userId,
          sessionId: asSessionId(sessionId),
          query: message,
          // SCRUM (launch-readiness D-2) — Voyage embed + memories table
          // are disabled for launch. The writer was never wired on a live
          // path so retrieval queries an empty table at the cost of one
          // ~300ms Voyage call per turn. memoryTopN=0 skips the Voyage
          // call entirely and recovers TTFT budget. Memory feature ships
          // (writer + retrieval) in a post-launch follow-up PR.
          memoryTopN: 0,
          recentTurnsLimit: 3,
        },
      );
      // SCRUM — surface partial context-fetch failures on the request log so
      // continuity issues can be correlated with degraded turns. The
      // underlying P2 incident is still emitted by context-fetch itself.
      if (ctx.partialFailure) {
        traceContextPartial = true;
        req.log.warn(
          { userId, sessionId, requestId: req.id },
          'coaching context fetch was partial — turn may be degraded',
        );
      }

      // ---- Build the prior-turns messages array first ---------------
      // Chunk-2 audit (2026-05-13) showed the model lost mentor identity
      // and past-tense continuity when prior turns lived only in the
      // system text. So we always pass them via the LLM's `messages[]`
      // parameter for proper conversation-tracking attention. Skip turns
      // with null/empty responseText to preserve the alternating
      // user/assistant invariant the API requires.
      const priorMessages = ctx.sessionTurns.flatMap((t) => {
        if (t.responseText === null || t.responseText === '') {
          return [];
        }
        return [
          { role: 'user' as const, content: t.userMessage },
          { role: 'assistant' as const, content: t.responseText },
        ];
      });

      // ---- Prompt assembly (v0_unified handles all response modes) ---
      // No practiceTag / levelTag — the validator's mode-dependent check was
      // removed 2026-05-13 (see prompt-assembly/validate.ts header note) and
      // the v0_unified assembler skips practice/level framing entirely.
      //
      // SCRUM — when priorMessages carries history, set historyInMessages so
      // the assembler omits the "Recent session context" block from the
      // system prompt. Previously both paths carried the transcript, costing
      // ~150 tokens per turn and (per the audit) confusing the model on
      // continued sessions.
      const promptBundle = await assemblePrompt(opts.config, opts.db, {
        userId,
        sessionId: asSessionId(sessionId),
        responseMode: 'FullCoachingResponse',
        userMessage: message,
        userProfile: ctx.profile,
        sessionTurns: ctx.sessionTurns,
        retrievedMemories: ctx.memories,
        historyInMessages: priorMessages.length > 0,
      });
      traceLibraryVersions = promptBundle.libraryVersions;

      sendEvent('start', { sessionId });

      const chatMessages = [...priorMessages, { role: 'user' as const, content: message }];
      const stream = chatStream(opts.config, {
        systemPrompt: promptBundle.assembledPrompt,
        messages: chatMessages,
        maxTokens: 600,
        temperature: 0.7,
      });

      let accumulated = '';
      let receivedDeltas = false;
      let final: { modelUsed: 'claude-haiku-4-5' | 'llama-3.3-70b' | 'safe-template' | 'none' } & {
        fallbackPath?: 'none' | 'fast-model' | 'safe-template' | 'service-unavailable';
      } = { modelUsed: 'claude-haiku-4-5' };

      try {
        // Manual iteration so we can capture the generator's return value.
        while (true) {
          // SCRUM-B9: client disconnected mid-stream — close the generator
          // (which closes the underlying Anthropic stream) and bail out.
          // Best-effort raw end in case the underlying socket is still
          // half-open; ignore errors since the peer is already gone.
          if (streamController.signal.aborted) {
            await stream.return(final as never);
            try {
              reply.raw.end();
            } catch {
              /* socket already closed */
            }
            return reply;
          }
          const next = await stream.next();
          if (next.done === true) {
            final = { ...next.value, fallbackPath: 'none' };
            break;
          }
          accumulated += next.value;
          receivedDeltas = true;
          sendEvent('delta', { text: next.value });
        }
      } catch (streamErr) {
        // SCRUM-F1: Anthropic streaming failed. If we haven't sent any words
        // to the user yet, fall back to non-streaming `chat()` — which uses
        // Anthropic Haiku first, then Groq Llama 3.3 on failure, then a safe
        // template if everything dies. Deliver the entire response as ONE
        // SSE delta + end so the existing client SSE loop handles it as a
        // (slightly delayed) normal turn.
        //
        // Mid-stream failures (after at least one delta was sent to the
        // browser) cannot be recovered — we've already shown the user
        // partial text. Re-throw to land in the outer catch and the SSE
        // error event path.
        if (receivedDeltas) {
          throw streamErr;
        }
        req.log.warn(
          { requestId: req.id, err: streamErr instanceof Error ? streamErr.message : 'unknown' },
          'F1: Anthropic stream open failed; attempting non-streaming fallback (Groq via chat())',
        );
        const fallbackResp = await chat(
          opts.config,
          {
            systemPrompt: promptBundle.assembledPrompt,
            messages: chatMessages,
            maxTokens: 600,
            temperature: 0.7,
          },
          'The coach is having trouble responding right now. Please try rephrasing or come back in a moment.',
        );
        accumulated = fallbackResp.text;
        // Deliver the entire fallback response as a single delta so the
        // client's existing SSE loop renders it correctly.
        sendEvent('delta', { text: fallbackResp.text });
        final = {
          modelUsed: fallbackResp.modelUsed,
          fallbackPath: fallbackResp.fallbackPath,
        };
      }

      // ---- Persist turn row ------------------------------------------
      const latencyMs = Date.now() - t0;
      let turnId: string | null = null;
      let persistFailed = false;
      if (isPrivate) {
        // SCRUM — Hard Rule #3 / privacy contract: private turns are
        // never written to the `turns` table. The session row was created
        // by the resolver; mark it isPrivate so the existing list/search
        // filters keep it off the user's history. turnCount stays at 0.
        await opts.db
          .update(sessions)
          .set({ isPrivate: true, lastTurnAt: new Date() })
          .where(eq(sessions.id, sessionId));
      } else {
        // SCRUM — wrap the turn insert + session bump in a single
        // transaction. Pre-fix, an insert success followed by a bump
        // failure left `turn_count=0` so the session never appeared in
        // the user's list even though the reply rendered. A transaction
        // makes that state unreachable: either both writes succeed and
        // the row surfaces, or both roll back and we emit a `warning`
        // SSE event so the client can surface "not saved".
        try {
          turnId = await opts.db.transaction(async (tx) => {
            const inserted = await tx
              .insert(turns)
              .values({
                sessionId,
                userId,
                userMessage: message,
                responseText: accumulated,
                modelUsed: final?.modelUsed ?? 'claude-haiku-4-5',
                latencyMs,
              })
              .returning({ id: turns.id });
            await tx
              .update(sessions)
              .set({
                lastTurnAt: new Date(),
                turnCount: drizzleSql`${sessions.turnCount} + 1`,
              })
              .where(eq(sessions.id, sessionId));
            return inserted[0]?.id ?? null;
          });
        } catch (err) {
          persistFailed = true;
          reportP2(
            'streaming turn persist failed (non-blocking)',
            {
              source: 'PhaseC.WebApi.Stream',
              extra: { error: err instanceof Error ? err.message : String(err) },
            },
            err,
          );
          // Tell the client the reply they just saw was not saved so the
          // UI can mark the turn accordingly. Sent BEFORE `end` so the
          // client's stream loop sees it before unwinding.
          sendEvent('warning', {
            code: 'persist_failed',
            correlationId: req.id,
            message: 'Your reply rendered but was not saved. Try sending again.',
          });
        }
      }

      sendEvent('end', { turnId, sessionId, latencyMs });
      reply.raw.end();
      // SCRUM-B9: the stream finished naturally; any late "close" event
      // from req.raw (e.g. the browser closing after the final byte) must
      // NOT abort a controller whose work is already done.
      streamCompleted = true;

      // Emit one TurnTrace per turn to Axiom (Process #2 §12c). Fire-and-
      // forget so it never blocks the response. PII-safe: userIdHash, never
      // raw userId (CLAUDE.md Hard Rule #3).
      emitTurnTrace(opts.traceEmitter, req.id, {
        userIdHash: hashUserId(userId),
        sessionId,
        turnId: turnId ?? '',
        terminalEvent: persistFailed
          ? 'Process_2.Step_StreamPersistFailed'
          : 'Process_2.Step_StreamComplete',
        // SCRUM-F1: the streaming handler now falls through to non-streaming
        // chat() (with Groq fallback) on Anthropic stream-open failures.
        // final.modelUsed and final.fallbackPath carry the real values from
        // whichever provider actually answered.
        modelUsed: final.modelUsed,
        fallbackPath: final.fallbackPath ?? 'none',
        latencyMs,
        qaOutcome: 'skipped',
        degradationFlags: {
          ...noDegradation(),
          contextFetchPartial: traceContextPartial,
          // SCRUM-F1: dashboards can filter on this to see "what % of turns
          // were served by Groq instead of Anthropic during a window" — the
          // single most actionable Anthropic-outage signal we have.
          fallbackModelUsed: final.modelUsed === 'llama-3.3-70b',
        },
        libraryVersions: traceLibraryVersions ?? emptyLibraryVersions(),
        determinismHash: null,
        retryCount: 0,
      });

      // SCRUM-F9: fire title generation on the user's 3rd message (when
      // resolved.turnCount === 2, meaning 2 turns already persisted, this
      // is the 3rd). Pre-fix this fired on the 1st turn of every session,
      // adding a second Anthropic call per session start (~30% per-session
      // cost overhead). Many sessions die after one turn (one-shot
      // questions, accidental "New Chat" clicks), so titling them is
      // wasted spend. Deferring to turn 3 saves roughly half of title-gen
      // calls while still titling any session the user has clearly
      // invested in.
      //
      // Title quality: generateSessionTitle now fetches the session's
      // FIRST user message internally (see session-title.ts), so the
      // title still summarises the opening topic, not the current turn.
      // The `message` arg below is kept as a safety fallback only.
      //
      // Private sessions never get a title (matches the no-persistence
      // contract). Persist failures also skip titling.
      if (!isPrivate && !persistFailed && resolved.turnCount === 2) {
        void generateSessionTitle(opts.config, opts.db, sessionId, message);
      }
      return reply;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      const isAssembly = err instanceof PromptAssemblyError;
      // Surface to dev console + Fastify log so the cause is visible without
      // having to spelunk Sentry/Axiom. Keeps reportP2 wired for prod traces.
      req.log.error(
        { err: { message: msg, stack, kind: isAssembly ? 'prompt-assembly' : 'llm-or-other' } },
        'streaming turn failed',
      );
      // SCRUM — pass the original error as the 3rd argument so the
      // incident reporter forwards the stack to Sentry. Without it the
      // dispatcher saw only the message string and grouped every
      // continue-session-class failure under a single fingerprint,
      // making them invisible in triage.
      reportP2(
        'streaming turn failed',
        {
          source: 'PhaseC.WebApi.Stream',
          extra: { error: msg, kind: isAssembly ? 'prompt-assembly' : 'llm-or-other' },
        },
        err,
      );
      try {
        // F4 (beta pre-flight): fixed generic copy. Raw exception text never
        // reaches the browser — it would leak Drizzle / Anthropic / postgres-js
        // internals, and any user-supplied content interpolated into a future
        // error path would cross-contaminate other users' screens. The
        // correlationId lets support resolve the user's incident against
        // Sentry / Axiom without exposing internals.
        sendEvent('error', {
          message: 'The coach is briefly unavailable. Please try again.',
          correlationId: req.id,
        });
        sendEvent('end', { turnId: null, sessionId: null, latencyMs: Date.now() - t0 });
        reply.raw.end();
      } catch {
        // Connection already closed; nothing to do.
      }
      // SCRUM-B9: error path has finished writing; suppress any spurious
      // abort triggered by the natural close that follows reply.raw.end().
      streamCompleted = true;
      // Emit a TurnTrace for the failed turn too, with whatever state was
      // resolved before the throw. Wrapped so an emit failure here can never
      // mask the original error.
      try {
        emitTurnTrace(opts.traceEmitter, req.id, {
          userIdHash: hashUserId(userId),
          sessionId: traceSessionId ?? '',
          turnId: '',
          terminalEvent: isAssembly
            ? 'Process_2.Step_StreamPromptAssemblyFailed'
            : 'Process_2.Step_StreamFailed',
          modelUsed: 'none',
          fallbackPath: 'service-unavailable',
          latencyMs: Date.now() - t0,
          qaOutcome: 'service-unavailable',
          degradationFlags: { ...noDegradation(), contextFetchPartial: traceContextPartial },
          libraryVersions: traceLibraryVersions ?? emptyLibraryVersions(),
          determinismHash: null,
          retryCount: 0,
        });
      } catch {
        /* swallow — trace loss is non-blocking */
      }
      return reply;
    }
  });

  // GET /api/sessions --------------------------------------------------
  // Cursor-style pagination: pass ?before=<sessionId>&limit=20 to fetch the
  // next page after the given session. Returns { sessions, hasMore }.
  // Default page size is 20; max is 100.
  app.get<{ Querystring: { before?: string; limit?: string } }>(
    '/api/sessions',
    async (req, reply) => {
      const session = await requireSupabaseSession(req, reply, opts, 'E1_SessionsList');
      if (session === null) return;

      const parsedLimit = Number.parseInt(req.query.limit ?? '20', 10);
      const pageLimit =
        Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20;
      const beforeId = req.query.before?.trim();

      // If a cursor was provided, resolve it to the cursor row's lastTurnAt so
      // we can filter strictly older sessions. Cursor must belong to the
      // requesting user (defence-in-depth; otherwise an attacker could probe
      // for the existence of arbitrary session IDs).
      let cursorLastTurnAt: Date | null = null;
      if (beforeId !== undefined && beforeId.length > 0) {
        const cur = await opts.db
          .select({
            id: sessions.id,
            userId: sessions.userId,
            lastTurnAt: sessions.lastTurnAt,
          })
          .from(sessions)
          .where(eq(sessions.id, beforeId))
          .limit(1);
        const c = cur[0];
        if (c !== undefined && c.userId === session.userId) {
          cursorLastTurnAt = c.lastTurnAt;
        } else {
          // SCRUM — silently fall through, but log the stale-cursor case so
          // frequent occurrences (UI bug? session deleted in another tab?)
          // can be detected via dashboard counts.
          req.log.debug(
            { cursor: beforeId, requestId: req.id },
            'stale_cursor: unknown or foreign session id on /api/sessions',
          );
        }
      }

      const baseConditions = [
        eq(sessions.userId, session.userId),
        eq(sessions.isPrivate, false),
        gt(sessions.turnCount, 0),
      ];
      if (cursorLastTurnAt !== null) {
        baseConditions.push(lt(sessions.lastTurnAt, cursorLastTurnAt));
      }

      // Fetch one more than the page size so we can detect hasMore without a
      // separate count query.
      const rows = await opts.db
        .select({
          id: sessions.id,
          title: sessions.title,
          startedAt: sessions.startedAt,
          lastTurnAt: sessions.lastTurnAt,
          turnCount: sessions.turnCount,
        })
        .from(sessions)
        .where(and(...baseConditions))
        .orderBy(desc(sessions.lastTurnAt))
        .limit(pageLimit + 1);

      const hasMore = rows.length > pageLimit;
      const pageRows = hasMore ? rows.slice(0, pageLimit) : rows;

      const now = Date.now();
      const oneWeek = 7 * 24 * 60 * 60 * 1000;
      const oneMonth = 30 * 24 * 60 * 60 * 1000;

      type Group = 'This week' | 'Earlier this month' | 'Older';
      const groupOf = (d: Date): Group => {
        const age = now - d.getTime();
        if (age < oneWeek) return 'This week';
        if (age < oneMonth) return 'Earlier this month';
        return 'Older';
      };
      const relative = (d: Date): string => {
        const age = now - d.getTime();
        const days = Math.floor(age / (24 * 60 * 60 * 1000));
        if (days < 1) return 'Today';
        if (days === 1) return 'Yesterday';
        if (days < 7) return `${days} days ago`;
        if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
        return `${Math.floor(days / 30)} months ago`;
      };

      return reply.send({
        sessions: pageRows.map((r) => ({
          id: r.id,
          title: r.title ?? 'Untitled session',
          msgs: r.turnCount,
          when: relative(r.lastTurnAt),
          group: groupOf(r.lastTurnAt),
        })),
        hasMore,
      });
    },
  );

  // GET /api/sessions/search -------------------------------------------
  // Case-insensitive ILIKE over session.title, scoped to the requesting
  // user, with the same cursor pagination contract as GET /api/sessions.
  // Bonus turn-text search (turns.user_message) is deferred — a JOIN
  // there needs a GIN index to stay under the latency budget at scale.
  app.get<{ Querystring: { q?: string; before?: string; limit?: string } }>(
    '/api/sessions/search',
    async (req, reply) => {
      const session = await requireSupabaseSession(req, reply, opts, 'E1_SessionsSearch');
      if (session === null) return;

      const q = req.query.q?.trim();
      if (q === undefined || q.length === 0) {
        return reply.code(400).send({ error: 'q is required' });
      }

      const parsedLimit = Number.parseInt(req.query.limit ?? '20', 10);
      const pageLimit =
        Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20;
      const beforeId = req.query.before?.trim();

      let cursorLastTurnAt: Date | null = null;
      if (beforeId !== undefined && beforeId.length > 0) {
        const cur = await opts.db
          .select({
            id: sessions.id,
            userId: sessions.userId,
            lastTurnAt: sessions.lastTurnAt,
          })
          .from(sessions)
          .where(eq(sessions.id, beforeId))
          .limit(1);
        const c = cur[0];
        if (c !== undefined && c.userId === session.userId) {
          cursorLastTurnAt = c.lastTurnAt;
        }
      }

      // Escape SQL LIKE metacharacters in the user-supplied term so a query
      // like "50%" matches the literal string, not "starts with 50".
      const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);
      const pattern = `%${escaped}%`;

      const baseConditions = [
        eq(sessions.userId, session.userId),
        eq(sessions.isPrivate, false),
        gt(sessions.turnCount, 0),
        isNotNull(sessions.title),
        ilike(sessions.title, pattern),
      ];
      if (cursorLastTurnAt !== null) {
        baseConditions.push(lt(sessions.lastTurnAt, cursorLastTurnAt));
      }

      const rows = await opts.db
        .select({
          id: sessions.id,
          title: sessions.title,
          startedAt: sessions.startedAt,
          lastTurnAt: sessions.lastTurnAt,
          turnCount: sessions.turnCount,
        })
        .from(sessions)
        .where(and(...baseConditions))
        .orderBy(desc(sessions.lastTurnAt))
        .limit(pageLimit + 1);

      const hasMore = rows.length > pageLimit;
      const pageRows = hasMore ? rows.slice(0, pageLimit) : rows;

      const now = Date.now();
      const oneWeek = 7 * 24 * 60 * 60 * 1000;
      const oneMonth = 30 * 24 * 60 * 60 * 1000;

      type Group = 'This week' | 'Earlier this month' | 'Older';
      const groupOf = (d: Date): Group => {
        const age = now - d.getTime();
        if (age < oneWeek) return 'This week';
        if (age < oneMonth) return 'Earlier this month';
        return 'Older';
      };
      const relative = (d: Date): string => {
        const age = now - d.getTime();
        const days = Math.floor(age / (24 * 60 * 60 * 1000));
        if (days < 1) return 'Today';
        if (days === 1) return 'Yesterday';
        if (days < 7) return `${days} days ago`;
        if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
        return `${Math.floor(days / 30)} months ago`;
      };

      return reply.send({
        sessions: pageRows.map((r) => ({
          id: r.id,
          title: r.title ?? 'Untitled session',
          msgs: r.turnCount,
          when: relative(r.lastTurnAt),
          group: groupOf(r.lastTurnAt),
        })),
        hasMore,
      });
    },
  );

  // GET /api/sessions/:id ----------------------------------------------
  // SCRUM — turn cap. Long sessions still return their most recent N turns
  // (oldest-first within the page); the response now signals `hasMore` so
  // the client can surface a "showing latest N turns" notice rather than
  // silently truncating. Pagination via a cursor parameter is the next
  // step (see follow-up ticket).
  const SESSION_TURN_LIMIT = 200;

  // SCRUM (launch-readiness audit #28) — Fastify's :id route param accepts
  // arbitrary strings, so requests like `GET /api/sessions/` (trailing slash
  // matching empty string) or `/api/sessions/not-a-uuid` fall through to
  // DB queries that always return 0 rows, masking client bugs and wasting
  // a query slot. Validate UUID shape at the handler top.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const session = await requireSupabaseSession(req, reply, opts, 'E1_SessionGet');
    if (session === null) return;
    if (!UUID_RE.test(req.params.id)) {
      return reply.code(400).send({ error: 'invalid_session_id' });
    }

    const row = await opts.db
      .select({
        id: sessions.id,
        title: sessions.title,
        userId: sessions.userId,
        isPrivate: sessions.isPrivate,
      })
      .from(sessions)
      .where(eq(sessions.id, req.params.id))
      .limit(1);
    const s = row[0];
    if (s === undefined || s.userId !== session.userId) {
      return reply.code(404).send({ error: 'not_found' });
    }

    // Fetch one more than the cap so we can detect overflow without a
    // separate COUNT.
    const turnRows = await opts.db
      .select({
        id: turns.id,
        userMessage: turns.userMessage,
        responseText: turns.responseText,
        createdAt: turns.createdAt,
      })
      .from(turns)
      .where(eq(turns.sessionId, s.id))
      .orderBy(turns.createdAt)
      .limit(SESSION_TURN_LIMIT + 1);

    const hasMore = turnRows.length > SESSION_TURN_LIMIT;
    const pageTurns = hasMore ? turnRows.slice(0, SESSION_TURN_LIMIT) : turnRows;

    return reply.send({
      session: { id: s.id, title: s.title, isPrivate: s.isPrivate },
      turns: pageTurns.map((t) => ({
        id: t.id,
        userMessage: t.userMessage,
        responseText: t.responseText,
        createdAt: t.createdAt.toISOString(),
      })),
      hasMore,
    });
  });

  // DELETE /api/sessions/:id -------------------------------------------
  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const session = await requireSupabaseSession(req, reply, opts, 'E1_SessionDelete');
    if (session === null) return;
    if (!UUID_RE.test(req.params.id)) {
      return reply.code(400).send({ error: 'invalid_session_id' });
    }

    const row = await opts.db
      .select({ id: sessions.id, userId: sessions.userId })
      .from(sessions)
      .where(eq(sessions.id, req.params.id))
      .limit(1);
    const s = row[0];
    if (s === undefined || s.userId !== session.userId) {
      return reply.code(404).send({ error: 'not_found' });
    }
    // FK on turns.session_id has ON DELETE CASCADE.
    await opts.db.delete(sessions).where(eq(sessions.id, s.id));
    return reply.send({ ok: true });
  });

  // GET /api/profile ---------------------------------------------------
  app.get('/api/profile', async (req, reply) => {
    const session = await requireSupabaseSession(req, reply, opts, 'E1_ProfileGet');
    if (session === null) return;

    const row = await opts.db
      .select({
        id: users.id,
        email: users.email,
        mappedPractices: users.mappedPractices,
        fullNameEncrypted: users.fullNameEncrypted,
        onboardingCompletedAt: users.onboardingCompletedAt,
        status: users.status,
      })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    const u = row[0];
    if (u === undefined) return reply.code(404).send({ error: 'user_not_found' });

    // fullName precedence: stored (decrypted) > Supabase user_metadata > ''.
    let fullName = '';
    if (typeof u.fullNameEncrypted === 'string' && u.fullNameEncrypted.length > 0) {
      try {
        fullName = decryptPlaintext(opts.config, u.fullNameEncrypted);
      } catch (err) {
        // SCRUM — pre-fix this was swallowed silently, so a rotated key or
        // corrupted ciphertext made the user's name render as "" with no
        // signal. Surface a P2 before the fallback so encryption drift
        // gets a ticket instead of a confusing UX.
        reportP2(
          'profile fullName decrypt failed (rendering empty)',
          {
            source: 'PhaseC.WebApi.Profile',
            extra: {
              userId: u.id,
              error: err instanceof Error ? err.message : String(err),
            },
          },
          err,
        );
        fullName = '';
      }
    }
    if (fullName === '') fullName = session.fullName;

    return reply.send({
      id: u.id,
      email: u.email ?? '',
      fullName,
      onboarded: u.status === 'onboarded' || u.onboardingCompletedAt !== null,
      mappedPractices: Array.isArray(u.mappedPractices) ? (u.mappedPractices as string[]) : [],
    });
  });

  // PATCH /api/profile -------------------------------------------------
  const KNOWN_PRACTICES = new Set([
    'Purpose',
    'Integrity',
    'Accountability',
    'Dignity',
    'Empathy',
    'Inclusion',
    'Assets',
    'Innovation',
    'Prosperity',
    'Humility',
    'Peace',
    'Democracy',
  ]);

  // SCRUM — canonical experience-band tokens. Must match the union in
  // web/src/lib/api.ts ProfilePatchBody and the formatter in
  // src/prompt-assembly/blocks.ts.
  const KNOWN_EXPERIENCE_BANDS = new Set(['<5', '5-10', '10+']);

  app.patch<{
    Body: Partial<{
      fullName: string;
      mappedPractices: string[];
      finishOnboarding: boolean;
      experienceBand: string;
    }>;
  }>('/api/profile', async (req, reply) => {
    const session = await requireSupabaseSession(req, reply, opts, 'E1_ProfilePatch');
    if (session === null) return;

    // Validate. Reject unknown values for the bounded enums.
    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (typeof req.body.fullName === 'string') {
      if (req.body.fullName.length > 200)
        return reply.code(400).send({ error: 'fullName_too_long' });
      update['fullNameEncrypted'] = encryptPlaintext(opts.config, req.body.fullName);
    }

    if (Array.isArray(req.body.mappedPractices)) {
      const incoming = req.body.mappedPractices.filter((p): p is string => typeof p === 'string');
      const invalid = incoming.filter((p) => !KNOWN_PRACTICES.has(p));
      if (invalid.length > 0)
        return reply.code(400).send({ error: 'invalid_practice', values: invalid });
      update['mappedPractices'] = incoming;
    }

    if (typeof req.body.experienceBand === 'string') {
      // SCRUM — onboarding used to drop this silently because the route had
      // no field for it. Coach prompt assembler keys on this value, so a
      // missing band degrades personalization across every turn.
      if (!KNOWN_EXPERIENCE_BANDS.has(req.body.experienceBand)) {
        return reply
          .code(400)
          .send({ error: 'invalid_experience_band', value: req.body.experienceBand });
      }
      update['experienceBand'] = req.body.experienceBand;
    }

    if (req.body.finishOnboarding === true) {
      update['status'] = 'onboarded';
      update['onboardingCompletedAt'] = new Date();
    }

    await opts.db.update(users).set(update).where(eq(users.id, session.userId));
    return reply.send({ ok: true });
  });

  // DELETE /api/profile (delete-account) -------------------------------
  app.delete('/api/profile', async (req, reply) => {
    const session = await requireSupabaseSession(req, reply, opts, 'E1_ProfileDelete');
    if (session === null) return;

    // FK ON DELETE CASCADE on sessions.user_id and turns.session_id will
    // walk the graph. (Profile-related rows that don't cascade get
    // cleaned up by the schema's other ON DELETE actions.)
    await opts.db.delete(users).where(eq(users.id, session.userId));
    return reply.send({ ok: true });
  });
}
