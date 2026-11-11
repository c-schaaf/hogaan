import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { hasCapability } from '../entitlements/index.js';
import { reportP0 } from '../incident-handling/index.js';
import { auditLog } from '../shared/db/schema/audit-log.js';
import { isEnabled } from '../shared/flags/index.js';
import { checkRateLimit } from '../shared/redis/rate-limit.js';
import type { WebApiRoutesOpts } from '../web-api/routes.js';
import { requireSupabaseSession } from '../web-api/supabase-session.js';
import { buildMcpServer } from './server.js';
import { createToken, listTokens, resolveToken, revokeToken } from './tokens.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * P3.1 — Hogaan MCP server on the existing Fastify app.
 *
 *   POST /mcp                       Streamable HTTP, stateless, JSON responses
 *   GET|DELETE /mcp                 405 (no sessions in stateless mode)
 *   GET  /api/mcp/tokens            list the leader's assistant connections
 *   POST /api/mcp/tokens {label}    create one (token shown once)
 *   DELETE /api/mcp/tokens/:id      revoke
 *
 * All 404 unless FEATURE_MCP is on. D6: requires the `mcp` capability (paid
 * tier once billing is on) and is rate limited with the existing per-user
 * limiter.
 */
export function registerMcpRoutes(app: FastifyInstance, opts: WebApiRoutesOpts): void {
  const off = () => !isEnabled(opts.config, 'mcp');

  app.get('/api/mcp/tokens', async (req, reply) => {
    if (off()) return reply.code(404).send({ error: 'feature_off' });
    const s = await requireSupabaseSession(req, reply, opts, 'E1_McpTokens');
    if (s === null) return;
    const allowed = await hasCapability(opts.config, opts.db, s.userId, 'mcp');
    return reply.send({ allowed, tokens: await listTokens(opts.db, s.userId) });
  });

  app.post<{ Body: { label?: unknown } }>('/api/mcp/tokens', async (req, reply) => {
    if (off()) return reply.code(404).send({ error: 'feature_off' });
    const s = await requireSupabaseSession(req, reply, opts, 'E1_McpTokens');
    if (s === null) return;
    if (!(await hasCapability(opts.config, opts.db, s.userId, 'mcp'))) {
      return reply.code(402).send({ error: 'upgrade_required', capability: 'mcp' });
    }
    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
    const t = await createToken(opts.db, s.userId, label);
    const base = opts.config.publicBaseUrl ?? '';
    return reply.send({ id: t.id, token: t.token, serverUrl: `${base}/mcp` });
  });

  app.delete<{ Params: { id: string } }>('/api/mcp/tokens/:id', async (req, reply) => {
    if (off()) return reply.code(404).send({ error: 'feature_off' });
    const s = await requireSupabaseSession(req, reply, opts, 'E1_McpTokens');
    if (s === null) return;
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: 'invalid_id' });
    const ok = await revokeToken(opts.db, s.userId, req.params.id);
    return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'not_found' });
  });

  const rpcError = (code: number, message: string) => ({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });

  app.post('/mcp', async (req, reply) => {
    if (off()) return reply.code(404).send({ error: 'feature_off' });
    const auth = req.headers.authorization;
    const token = typeof auth === 'string' && /^bearer /i.test(auth) ? auth.slice(7).trim() : '';
    const userId = token === '' ? null : await resolveToken(opts.db, token);
    if (userId === null) {
      void reply.header('WWW-Authenticate', 'Bearer realm="hogaan"');
      return reply
        .code(401)
        .send(rpcError(-32001, 'Unauthorized: create a token in Hogaan > Profile'));
    }
    if (!(await hasCapability(opts.config, opts.db, userId, 'mcp'))) {
      return reply
        .code(403)
        .send(rpcError(-32002, 'Hogaan for AI assistants is part of the paid plan.'));
    }
    let decision: Awaited<ReturnType<typeof checkRateLimit>>;
    try {
      decision = await checkRateLimit(opts.rateLimiters, 'mcp', `mcp:${userId}`);
    } catch {
      decision = { decision: 'PROCEED' }; // fail-open, same as chat (SCRUM-B5)
    }
    if (decision.decision !== 'PROCEED') {
      return reply.code(429).send(rpcError(-32003, 'Too many requests. Try again later.'));
    }

    const server = buildMcpServer({
      config: opts.config,
      db: opts.db,
      userId,
      // P3.4 — fail-closed audit row per tool call.
      audit: async (tool) => {
        try {
          await opts.db.insert(auditLog).values({
            requestId: req.id,
            triggerSource: 'mcp',
            userId,
            targetEndEvent: `MCP_${tool}`,
            ipAddress: req.ip ?? null,
          });
        } catch (err) {
          reportP0(
            'mcp: audit_log insert failed — tool refused (fail-closed)',
            { source: 'Mcp.Audit', extra: { tool, requestId: req.id } },
            err,
          );
          throw err;
        }
      },
    });
    // Stateless mode: no sessionIdGenerator (omitted rather than passed as
    // undefined, which exactOptionalPropertyTypes forbids — same effect).
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (err) {
      req.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        'mcp request failed',
      );
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
        reply.raw.end(JSON.stringify(rpcError(-32603, 'Internal server error')));
      }
    }
  });

  const notAllowed = (
    _req: unknown,
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ) => reply.code(405).send(rpcError(-32000, 'Method not allowed.'));
  app.get('/mcp', (req, reply) =>
    off() ? reply.code(404).send({ error: 'feature_off' }) : notAllowed(req, reply),
  );
  app.delete('/mcp', (req, reply) =>
    off() ? reply.code(404).send({ error: 'feature_off' }) : notAllowed(req, reply),
  );
}
