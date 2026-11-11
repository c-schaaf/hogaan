import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../shared/secrets/config.js';

/**
 * Phase E - serve the Vite-built SPA from <dist/web>. Registers
 * @fastify/static rooted at the build output and installs a notFound
 * handler that falls back to index.html for SPA client routes.
 *
 * The static directory is resolved relative to the running module so the
 * same wiring works in dev (tsx running src/) and in production (node
 * running dist/), as long as `tsx scripts/copy-assets.ts` has copied
 * dist/web into the bundle.
 *
 * Skips silently if the directory doesn't exist (e.g. dev API server
 * without a build). Vite's own dev server on port 5173 covers that case.
 */
export async function wireWebStatic(
  app: FastifyInstance,
  _config: AppConfig,
  rootOverride?: string,
): Promise<{ registered: boolean; reason?: string }> {
  const root =
    rootOverride !== undefined && existsSync(rootOverride) ? rootOverride : locateWebDist();
  if (root === null) {
    return { registered: false, reason: 'dist/web not present (run pnpm build:web)' };
  }

  await app.register(fastifyStatic, {
    root,
    prefix: '/',
    wildcard: false, // exact-file match only - the notFound handler does SPA fallback
    decorateReply: true,
  });

  app.setNotFoundHandler((req, reply) => {
    // Only serve index.html for browser-like GETs that aren't API/webhook routes.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return reply.code(404).send({ error: 'not_found' });
    }
    const url = req.url.split('?')[0] ?? '/';
    if (
      url.startsWith('/api/') ||
      url === '/mcp' ||
      url.startsWith('/webhooks/') ||
      url.startsWith('/portal/') ||
      url.startsWith('/auth/') ||
      url === '/healthz' ||
      url === '/readyz'
    ) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const replyWithSendFile = reply as unknown as {
      sendFile: (filename: string) => unknown;
    };
    if (typeof replyWithSendFile.sendFile !== 'function') {
      return reply.code(500).send({ error: 'static_not_registered' });
    }
    return replyWithSendFile.sendFile('index.html');
  });

  return { registered: true };
}

function locateWebDist(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Walk up looking for dist/web; supports running from src/ (tsx) and dist/ (built).
  const candidates = [
    path.resolve(here, '../../dist/web'),
    path.resolve(here, '../../../dist/web'),
    path.resolve(here, '../../web'),
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).isDirectory()) return c;
    } catch {
      // try next
    }
  }
  return null;
}
