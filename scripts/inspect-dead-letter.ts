import 'dotenv/config';
import { getRedis } from '../src/shared/redis/client.js';
import { loadConfig } from '../src/shared/secrets/config.js';
import {
  INBOUND_DEAD_LETTER_KEY,
  type DeadLetterItem,
} from '../src/whatsapp-delivery/queue-processor.js';

/**
 * R22 — ops triage view of the inbound webhook dead-letter queue.
 *
 * The processor LPUSHes failed payloads here (LTRIM-bounded at 1000) so a
 * human can inspect what blew up without reaching for Redis directly.
 *
 *   pnpm exec tsx scripts/inspect-dead-letter.ts        # show 20 most recent
 *   pnpm exec tsx scripts/inspect-dead-letter.ts 50     # show 50 most recent
 *
 * This script ONLY reads. To clear an entry after triage, use redis-cli or
 * write a follow-up script — keeping reads/writes separate avoids accidental
 * data loss during ops review.
 */

async function main(): Promise<void> {
  const limit = Number(process.argv[2] ?? '20');
  const config = loadConfig();
  const redis = getRedis(config);

  const len = (await redis.client.llen(INBOUND_DEAD_LETTER_KEY)) ?? 0;
  console.log(`dead-letter queue length: ${len}`);
  if (len === 0) {
    console.log('(nothing to triage)');
    return;
  }

  // LRANGE 0..N-1 gives the N most-recently pushed entries (LPUSH puts
  // newest at index 0).
  const raw = await redis.client.lrange(INBOUND_DEAD_LETTER_KEY, 0, limit - 1);
  const items: DeadLetterItem[] = raw.map((entry: unknown) =>
    typeof entry === 'string' ? (JSON.parse(entry) as DeadLetterItem) : (entry as DeadLetterItem),
  );

  for (let i = 0; i < items.length; i += 1) {
    const it = items[i]!;
    console.log('---');
    console.log(`#${i} failedAt    ${it.failedAt}`);
    console.log(`    sid          ${it.inboundMessageSid}`);
    console.log(`    fromPrefix   ${it.fromE164.slice(0, 7)}…  (full number redacted)`);
    console.log(`    traceId      ${it.traceId}`);
    console.log(`    error        ${it.errorName}: ${it.errorMessage}`);
    if (it.body !== '') {
      console.log(`    body[0:80]   ${it.body.slice(0, 80).replace(/\n/g, ' ')}`);
    }
    if (it.mediaUrls.length > 0) {
      console.log(`    media        ${it.mediaUrls.length} URL(s) (redacted)`);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
