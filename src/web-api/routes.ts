import { and, desc, eq, gt, sql as drizzleSql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { fetchCoachingContext } from '../coaching/context-fetch.js';
import { runCoachingTurn } from '../coaching/orchestrator.js';
import { fastPathTriage } from '../coaching/triage.js';
import type { CoachingInbound } from '../coaching/types.js';
import { reportP2 } from '../incident-handling/index.js';
import { assemblePrompt, PromptAssemblyError } from '../prompt-assembly/index.js';
import { resolveSession } from '../session-lifecycle/index.js';
import type { Database } from '../shared/db/client.js';
import { hashPhone } from '../shared/db/encryption.js';
import { sessions } from '../shared/db/schema/sessions.js';
import { turns } from '../shared/db/schema/turns.js';
import { users } from '../shared/db/schema/users.js';
import { chatStream } from '../shared/llm/chat.js';
import type { RedisBundle } from '../shared/redis/client.js';
import type { RateLimiters } from '../shared/redis/rate-limit.js';
import type { AppConfig } from '../shared/secrets/config.js';
import type { TraceEmitter } from '../shared/trace/index.js';
import { asPhoneE164, asSessionId, asUserId } from '../shared/types/index.js';
import { generateSessionTitle } from './session-title.js';
import { requireSupabaseSession } from './supabase-session.js';

export interface WebApiRoutesOpts {
  config: AppConfig;
  db: Database;
  redis: RedisBundle;
  rateLimiters: RateLimiters;
  traceEmitter: TraceEmitter;
}

/**
 * Phase C - end-user web API routes. All require a valid web session
 * cookie (set by /api/auth/verify after a magic-link click).
 *
 *   POST /api/chat/turn       { message, sessionId?, private? } -> { responseText, sessionId, turnId, crisis }
 *   GET  /api/sessions                                          -> grouped session list
 *   GET  /api/sessions/:id                                      -> session + turn history
 *   DELETE /api/sessions/:id                                    -> hard delete (cascades to turns)
 *   GET  /api/profile                                           -> profile snapshot
 *   PATCH /api/profile        { mappedPractices?, commStyle?, responseDepth?, fullName? }
 *   DELETE /api/profile                                         -> hard delete account + all data
 *
 * The coaching brain (runCoachingTurn) is reused as-is - the new
 * channel='web' flag in CoachingInbound suppresses Twilio dispatch and
 * isPrivate=true suppresses turns-table writes.
 */
export function registerWebApiRoutes(app: FastifyInstance, opts: WebApiRoutesOpts): void {
  // POST /api/chat/turn ------------------------------------------------
  app.post<{
    Body: { message?: unknown; sessionId?: unknown; private?: unknown };
  }>('/api/chat/turn', async (req, reply) => {
    const session = await requireSupabaseSession(req, reply, opts);
    if (session === null) return;

    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (message.length === 0) {
      return reply.code(400).send({ error: 'message_required' });
    }
    const isPrivate = req.body?.private === true;
    // sessionId from the client is informational only in v1 - the
    // session-lifecycle resolver decides whether to open a new session
    // or continue an active one based on lastTurnAt. Reopening a
    // closed session by id is a follow-up.

    const inbound: CoachingInbound = {
      userId: asUserId(session.userId),
      // Synthetic E.164 for web users; the orchestrator hashes this for
      // suppression checks but no Twilio dispatch ever happens (sendBody
      // short-circuits when channel === 'web').
      phoneE164: asPhoneE164(`web:${session.userId}`),
      phoneHash: hashPhone(`web:${session.userId}`),
      body: message,
      mediaUrls: [],
      inboundMessageId: `web-${req.id}`,
      receivedAt: new Date(),
      traceId: String(req.id),
      channel: 'web',
      isPrivate,
    };

    const result = await runCoachingTurn(
      {
        config: opts.config,
        db: opts.db,
        redis: opts.redis,
        rateLimiters: opts.rateLimiters,
        traceEmitter: opts.traceEmitter,
      },
      inbound,
    );

    // If private mode, flag the session row so the list endpoint filters it.
    if (isPrivate && result.sessionId !== 'pending') {
      try {
        await opts.db
          .update(sessions)
          .set({ isPrivate: true })
          .where(eq(sessions.id, result.sessionId));
      } catch (err) {
        reportP2('failed to flag session is_private', {
          source: 'PhaseC.WebApi',
          extra: { error: err instanceof Error ? err.message : String(err) },
        });
      }
    }

    // Generate a session title via Haiku after the first non-private turn.
    // Fire-and-forget so the user doesn't wait. The helper no-ops if a
    // title is already set, so re-tries on subsequent turns are cheap.
    if (!isPrivate && result.sessionId !== 'pending') {
      void generateSessionTitle(opts.config, opts.db, result.sessionId, message);
    }

    return reply.send({
      responseText: result.responseText,
      sessionId: result.sessionId,
      turnId: result.turnId,
      endEvent: result.endEvent,
    });
  });

  // POST /api/chat/turn/stream ----------------------------------------
  // Streaming variant of /api/chat/turn. Returns Server-Sent Events:
  //   event: start   data: { sessionId }
  //   event: delta   data: { text }            (one per token chunk)
  //   event: end     data: { turnId, sessionId, latencyMs }
  //   event: error   data: { message }         (on any failure mid-stream)
  //
  // The path is intentionally a minimal inline orchestration that bypasses
  // runCoachingTurn — we need direct control over the LLM call to surface
  // chunks as they arrive. QC, tagger, voice-grading are all already off
  // per 2026-05-13; the streaming path simply embodies that simplified
  // pipeline.
  app.post<{
    Body: { message?: unknown; sessionId?: unknown; private?: unknown };
  }>('/api/chat/turn/stream', async (req, reply) => {
    const session = await requireSupabaseSession(req, reply, opts);
    if (session === null) return;

    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (message.length === 0) {
      return reply.code(400).send({ error: 'message_required' });
    }
    const isPrivate = req.body?.private === true;

    const t0 = Date.now();
    const userId = asUserId(session.userId);

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

    try {
      // ---- Fast-path triage (no LLM) ---------------------------------
      const sync = fastPathTriage(message, []);
      // empty/media_only on the streaming endpoint shouldn't happen (web
      // sends text-only), but if it does just emit the templated copy.
      if (sync !== null && sync.status === 'media_only') {
        sendEvent('delta', {
          text: "I work with text only for now. Type out what's on your mind and I'll respond.",
        });
        sendEvent('end', { turnId: null, sessionId: null, latencyMs: Date.now() - t0 });
        reply.raw.end();
        return reply;
      }

      // ---- Session resolution ----------------------------------------
      const resolved = await resolveSession(opts.db, { userId });
      const sessionId = resolved.sessionId;

      // ---- Context fetch (profile + recent turns + memory) -----------
      const ctx = await fetchCoachingContext(
        { config: opts.config, db: opts.db },
        {
          userId,
          sessionId: asSessionId(sessionId),
          query: message,
          memoryTopN: 3,
          recentTurnsLimit: 3,
        },
      );

      // ---- Prompt assembly (v0_unified handles all response modes) ---
      // No practiceTag / levelTag — the validator's mode-dependent check was
      // removed 2026-05-13 (see prompt-assembly/validate.ts header note) and
      // the v0_unified assembler skips practice/level framing entirely.
      const promptBundle = await assemblePrompt(opts.config, opts.db, {
        userId,
        sessionId: asSessionId(sessionId),
        responseMode: 'FullCoachingResponse',
        userMessage: message,
        userProfile: ctx.profile,
        sessionTurns: ctx.sessionTurns,
        retrievedMemories: ctx.memories,
      });

      sendEvent('start', { sessionId });

      // ---- Stream the response ---------------------------------------
      // Pass prior turns as proper conversation messages, not as flattened
      // text in the system prompt. The assembler still embeds them in the
      // assembledPrompt (acceptable duplication for now — ~150 token cost),
      // but the model's conversation-tracking attention only fires on the
      // messages array. Chunk-2 audit (2026-05-13) showed the model
      // hallucinated "I'm coming in mid-conversation" and lost mentor
      // identity / past-tense / cultural specifics when prior turns lived
      // only in the system text. Skip turns with null/empty responseText to
      // preserve the alternating user/assistant invariant the API requires.
      const priorMessages = ctx.sessionTurns.flatMap((t) => {
        if (t.responseText === null || t.responseText === '') {
          return [];
        }
        return [
          { role: 'user' as const, content: t.userMessage },
          { role: 'assistant' as const, content: t.responseText },
        ];
      });

      const stream = chatStream(opts.config, {
        systemPrompt: promptBundle.assembledPrompt,
        messages: [...priorMessages, { role: 'user', content: message }],
        maxTokens: 600,
        temperature: 0.7,
      });

      let accumulated = '';
      let final;
      // Manual iteration so we can capture the generator's return value.
      while (true) {
        const next = await stream.next();
        if (next.done === true) {
          final = next.value;
          break;
        }
        accumulated += next.value;
        sendEvent('delta', { text: next.value });
      }

      // ---- Persist turn row ------------------------------------------
      const latencyMs = Date.now() - t0;
      let turnId: string | null = null;
      try {
        const inserted = await opts.db
          .insert(turns)
          .values({
            sessionId,
            userId,
            userMessage: message,
            responseText: accumulated,
            intent: 'Coaching',
            practiceTag: 'integrity',
            levelTag: 'self',
            taggerConfidence: '0',
            responseMode: 'FullCoachingResponse',
            modelUsed: final?.modelUsed ?? 'claude-haiku-4-5',
            fallbackPath: 'none',
            qaOutcome: 'E1_ApprovedFirstAttempt',
            latencyMs,
            terminalEvent: 'E1_TurnCompleted',
          })
          .returning({ id: turns.id });
        turnId = inserted[0]?.id ?? null;

        // Bump session.lastTurnAt / turnCount.
        await opts.db
          .update(sessions)
          .set({
            lastTurnAt: new Date(),
            turnCount: drizzleSql`${sessions.turnCount} + 1`,
            ...(isPrivate ? { isPrivate: true } : {}),
          })
          .where(eq(sessions.id, sessionId));
      } catch (err) {
        reportP2(
          'streaming turn persist failed (non-blocking)',
          {
            source: 'PhaseC.WebApi.Stream',
            extra: { error: err instanceof Error ? err.message : String(err) },
          },
          err,
        );
      }

      sendEvent('end', { turnId, sessionId, latencyMs });
      reply.raw.end();

      // Fire-and-forget session title generation (after the user sees their reply).
      if (!isPrivate) {
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
      reportP2('streaming turn failed', {
        source: 'PhaseC.WebApi.Stream',
        extra: { error: msg, kind: isAssembly ? 'prompt-assembly' : 'llm-or-other' },
      });
      try {
        // Echo the actual error message back to the client (dev-friendly).
        // Tighten this to a generic copy before launch.
        sendEvent('error', { message: `stream failed: ${msg.slice(0, 300)}` });
        sendEvent('end', { turnId: null, sessionId: null, latencyMs: Date.now() - t0 });
        reply.raw.end();
      } catch {
        // Connection already closed; nothing to do.
      }
      return reply;
    }
  });

  // GET /api/sessions --------------------------------------------------
  app.get('/api/sessions', async (req, reply) => {
    const session = await requireSupabaseSession(req, reply, opts);
    if (session === null) return;

    const rows = await opts.db
      .select({
        id: sessions.id,
        title: sessions.title,
        startedAt: sessions.startedAt,
        lastTurnAt: sessions.lastTurnAt,
        turnCount: sessions.turnCount,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, session.userId),
          eq(sessions.isPrivate, false),
          gt(sessions.turnCount, 0),
        ),
      )
      .orderBy(desc(sessions.lastTurnAt))
      .limit(200);

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
      sessions: rows.map((r) => ({
        id: r.id,
        title: r.title ?? 'Untitled session',
        msgs: r.turnCount,
        when: relative(r.lastTurnAt),
        group: groupOf(r.lastTurnAt),
      })),
    });
  });

  // GET /api/sessions/:id ----------------------------------------------
  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const session = await requireSupabaseSession(req, reply, opts);
    if (session === null) return;

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
      .limit(200);

    return reply.send({
      session: { id: s.id, title: s.title, isPrivate: s.isPrivate },
      turns: turnRows.map((t) => ({
        id: t.id,
        userMessage: t.userMessage,
        responseText: t.responseText,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  });

  // DELETE /api/sessions/:id -------------------------------------------
  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const session = await requireSupabaseSession(req, reply, opts);
    if (session === null) return;

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
    const session = await requireSupabaseSession(req, reply, opts);
    if (session === null) return;

    const row = await opts.db
      .select({
        id: users.id,
        email: users.email,
        mappedPractices: users.mappedPractices,
        commStyle: users.commStyle,
        responseDepth: users.responseDepth,
        profileFlags: users.profileFlags,
        onboardingCompletedAt: users.onboardingCompletedAt,
        status: users.status,
      })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    const u = row[0];
    if (u === undefined) return reply.code(404).send({ error: 'user_not_found' });

    const fullName =
      typeof u.profileFlags === 'object' && u.profileFlags !== null && 'fullName' in u.profileFlags
        ? (() => {
            const v = (u.profileFlags as { fullName?: unknown }).fullName;
            return typeof v === 'string' ? v : '';
          })()
        : '';

    return reply.send({
      id: u.id,
      email: u.email ?? '',
      fullName,
      onboarded: u.status === 'onboarded' || u.onboardingCompletedAt !== null,
      mappedPractices: Array.isArray(u.mappedPractices) ? (u.mappedPractices as string[]) : [],
      commStyle: u.commStyle ?? null,
      responseDepth: u.responseDepth ?? null,
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

  app.patch<{
    Body: Partial<{
      fullName: string;
      mappedPractices: string[];
      commStyle: 'direct' | 'warm';
      responseDepth: 'quick' | 'standard' | 'deep';
      finishOnboarding: boolean;
    }>;
  }>('/api/profile', async (req, reply) => {
    const session = await requireSupabaseSession(req, reply, opts);
    if (session === null) return;

    // Validate. Reject unknown values for the bounded enums.
    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (typeof req.body.fullName === 'string') {
      if (req.body.fullName.length > 200)
        return reply.code(400).send({ error: 'fullName_too_long' });
      // Merge into profileFlags JSON (full_name_encrypted writes come later).
      const row = await opts.db
        .select({ profileFlags: users.profileFlags })
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1);
      const existing =
        row[0] !== undefined &&
        typeof row[0].profileFlags === 'object' &&
        row[0].profileFlags !== null
          ? (row[0].profileFlags as Record<string, unknown>)
          : {};
      update['profileFlags'] = { ...existing, fullName: req.body.fullName };
    }

    if (Array.isArray(req.body.mappedPractices)) {
      const incoming = req.body.mappedPractices.filter((p): p is string => typeof p === 'string');
      const invalid = incoming.filter((p) => !KNOWN_PRACTICES.has(p));
      if (invalid.length > 0)
        return reply.code(400).send({ error: 'invalid_practice', values: invalid });
      update['mappedPractices'] = incoming;
    }
    if (req.body.commStyle === 'direct' || req.body.commStyle === 'warm') {
      update['commStyle'] = req.body.commStyle;
    }
    if (
      req.body.responseDepth === 'quick' ||
      req.body.responseDepth === 'standard' ||
      req.body.responseDepth === 'deep'
    ) {
      update['responseDepth'] = req.body.responseDepth;
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
    const session = await requireSupabaseSession(req, reply, opts);
    if (session === null) return;

    // FK ON DELETE CASCADE on sessions.user_id and turns.session_id will
    // walk the graph. (Profile-related rows that don't cascade get
    // cleaned up by the schema's other ON DELETE actions.)
    await opts.db.delete(users).where(eq(users.id, session.userId));
    return reply.send({ ok: true });
  });

  // Reserved for future use.
  void drizzleSql;
}
