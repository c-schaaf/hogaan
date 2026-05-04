import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { getDb } from '../src/shared/db/client.js';
import { buildRateLimiters } from '../src/shared/redis/rate-limit.js';
import { getRedis } from '../src/shared/redis/client.js';
import { loadConfig } from '../src/shared/secrets/config.js';
import { sendOutbound } from '../src/whatsapp-delivery/orchestrator.js';
import { asCorrelationId } from '../src/shared/types/index.js';

/**
 * End-to-end Twilio sandbox smoke test.
 *
 * Usage:
 *   pnpm exec tsx scripts/send-test-message.ts <e164-phone> "<body>"
 *
 * Example:
 *   pnpm exec tsx scripts/send-test-message.ts +252612345678 "Hello from Hogaan staging"
 *
 * Prereqs (sandbox):
 *   1. The recipient phone must have texted "join <keyword>" to the sandbox
 *      number (+1 415 523 8886) within the last 24h. Twilio's sandbox only
 *      delivers to whitelisted numbers.
 *   2. .env (or Render env) must have:
 *        TWILIO_ACCOUNT_SID
 *        TWILIO_AUTH_TOKEN
 *        TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
 *        UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *        DATABASE_URL
 *
 * Goes through the full Process #11 pipeline: validate → idempotency lookup
 * → suppression check → 24h window (skipped — no userId in this CLI path)
 * → template validation (FreeForm path, skipped) → rate limit → idempotency
 * acquire → Twilio dispatch (5s, 3 retries on 5xx) → record receipt.
 *
 * Returns the terminal end event so we can confirm the path taken.
 */

async function main(): Promise<void> {
  const [, , phoneArg, ...bodyArgs] = process.argv;
  if (typeof phoneArg !== 'string' || phoneArg.length === 0) {
    console.error('usage: tsx scripts/send-test-message.ts <e164-phone> "<body>"');
    process.exit(2);
  }
  const body = bodyArgs.join(' ').trim();
  if (body.length === 0) {
    console.error('body is required (and must be non-empty)');
    process.exit(2);
  }

  const config = loadConfig();
  const { db, close } = getDb(config);
  const redis = getRedis(config);
  const rateLimiters = buildRateLimiters(redis, {
    perSecondLimit: 80,
    perDayLimit: 1000,
    perUserPerHourLimit: 20,
  });

  const correlationId = asCorrelationId(`test-${randomUUID()}`);
  console.log('correlationId:', correlationId);
  console.log('to:', phoneArg);
  console.log('from:', config.twilioWhatsAppFrom ?? '<TWILIO_WHATSAPP_FROM not set>');
  console.log('body length:', body.length);

  const result = await sendOutbound(
    { config, db, redis, rateLimiters, ownerId: 'cli:send-test-message' },
    {
      correlationId,
      callerProcessId: 'cli:send-test-message',
      phoneE164: phoneArg,
      messageType: 'FreeForm',
      priority: 'Normal',
      body,
    },
  );

  console.log('result:');
  console.log(JSON.stringify(result, null, 2));

  await close();

  if (
    result.endEvent === 'E1_MessageDispatched' ||
    result.endEvent === 'E2_MessageDispatchedAfterRetry'
  ) {
    console.log('OK: dispatched');
    process.exit(0);
  }
  console.error(`NOT-DISPATCHED: ${result.endEvent} (${result.reason ?? 'no reason'})`);
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error('send-test-message failed:', err);
  process.exit(1);
});
