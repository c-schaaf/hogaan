import 'dotenv/config';
import { performance } from 'node:perf_hooks';
import { runCoachingTurn } from '../src/coaching/index.js';
import { recordEvidence } from '../src/shared/audit-evidence/index.js';
import { getDb } from '../src/shared/db/client.js';
import { getRedis } from '../src/shared/redis/client.js';
import { buildRateLimiters } from '../src/shared/redis/rate-limit.js';
import { encryptPlaintext, hashPhone } from '../src/shared/db/encryption.js';
import { users } from '../src/shared/db/schema/users.js';
import { whatsappMessages } from '../src/shared/db/schema/whatsapp-messages.js';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../src/shared/secrets/config.js';
import { buildTraceEmitter } from '../src/shared/trace/index.js';
import { asPhoneE164, asUserId } from '../src/shared/types/index.js';

/**
 * Phase 10.4 — latency profiling harness.
 *
 * Drives N concurrent coaching turns against a synthetic test user, captures
 * end-to-end latencies, computes p50 / p95 / p99, and writes audit evidence
 * tagged T4.Latency.<scenario>.
 *
 * GATING: this harness makes REAL LLM calls (Anthropic + Groq + Voyage)
 * and REAL Twilio API calls when --send is passed. That costs money. The
 * default mode is `--no-send` (Twilio dispatch is short-circuited via
 * the in-window check). Concurrency defaults to 5; --concurrency 20+ is
 * the master-plan target but should only be run after explicit ops
 * approval since it spends ~$0.50–$2 per run.
 *
 * Usage:
 *
 *   pnpm exec tsx scripts/profile-latency.ts                    # 5 concurrent, no real send
 *   pnpm exec tsx scripts/profile-latency.ts --concurrency 20   # 20 concurrent, no real send
 *   pnpm exec tsx scripts/profile-latency.ts --concurrency 20 --send +254xxx  # production-like
 *
 * Latency budget per CLAUDE.md hard rule #2: p99 ≤ 6000ms total turn.
 */

interface Args {
  concurrency: number;
  send: string | undefined;
  scenario: string;
  iterations: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const concurrencyRaw = get('--concurrency');
  const concurrency = concurrencyRaw !== undefined ? Number.parseInt(concurrencyRaw, 10) : 5;
  if (Number.isNaN(concurrency) || concurrency <= 0 || concurrency > 100) {
    throw new Error('--concurrency must be a positive integer ≤ 100');
  }
  const send = get('--send');
  const scenario = get('--scenario') ?? 'SteadyState';
  const iterRaw = get('--iterations');
  const iterations = iterRaw !== undefined ? Number.parseInt(iterRaw, 10) : concurrency;
  return { concurrency, send, scenario, iterations };
}

const SAMPLE_MESSAGES = [
  'I have a difficult conversation with a direct report tomorrow about under-performance. How do I open it?',
  'My team just missed a deadline. Two reports are blaming each other. What is the question I walk into the room with?',
  'I want to be a better leader for my team but I keep falling back into command-and-control. What do I try first?',
  'My CEO asked me to do something I disagree with on principle. I am not sure if I should push back or comply.',
  'I have to lay off a long-time employee who has helped build the company. How do I do this with dignity?',
  'I am exhausted from trying to motivate my team. I think I am the problem. What should I look at?',
  'A junior team member came to me with a strategic insight that contradicts our roadmap. How do I handle it?',
];

interface TurnSample {
  startedAt: number;
  finishedAt: number;
  latencyMs: number;
  endEvent: string;
  withinBudget: boolean;
}

async function provisionTestUser(
  db: ReturnType<typeof getDb>['db'],
  config: ReturnType<typeof loadConfig>,
  phoneE164: string,
): Promise<{ userId: string; phoneHash: string }> {
  const phoneHash = hashPhone(phoneE164);
  const phoneEncrypted = encryptPlaintext(config, phoneE164);
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phoneHash, phoneHash))
    .limit(1);
  let userId: string;
  if (existing[0] !== undefined) {
    userId = existing[0].id;
    await db
      .update(users)
      .set({
        status: 'onboarded',
        phoneEncrypted,
        role: 'Professional',
        location: 'Mogadishu',
        timezone: 'Africa/Mogadishu',
        isDiaspora: false,
      })
      .where(eq(users.id, userId));
  } else {
    const ins = await db
      .insert(users)
      .values({
        phoneHash,
        phoneEncrypted,
        status: 'onboarded',
        lastCompletedStep: 7,
        role: 'Professional',
        location: 'Mogadishu',
        timezone: 'Africa/Mogadishu',
        isDiaspora: false,
        onboardingCompletedAt: new Date(),
      })
      .returning({ id: users.id });
    userId = ins[0]!.id;
  }
  // Ensure 24h window is open for FreeForm sends.
  await db.insert(whatsappMessages).values({
    correlationId: `latency-inbound-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    callerProcessId: 'profile-latency',
    userId,
    direction: 'inbound',
    messageType: 'free_form',
    contentText: 'hello',
    priority: 'Normal',
    status: 'sent',
    lastStatusAt: new Date(),
  });
  return { userId, phoneHash };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const config = loadConfig();
  const { db, close } = getDb(config);
  const redis = getRedis(config);
  const rateLimiters = buildRateLimiters(redis, {
    perSecondLimit: 80,
    perDayLimit: 1000,
    perUserPerHourLimit: 50,
  });
  const traceEmitter = buildTraceEmitter(config);

  const phone = args.send ?? '+254700009999'; // synthetic
  console.log(
    `--- latency profile ---\nscenario=${args.scenario} concurrency=${args.concurrency} iterations=${args.iterations}`,
  );
  console.log(args.send !== undefined ? `LIVE SEND to ${phone}` : 'no real Twilio dispatch');

  try {
    const u = await provisionTestUser(db, config, phone);

    const t0Wall = performance.now();
    const samples: TurnSample[] = [];
    let cursor = 0;

    async function worker(): Promise<void> {
      while (true) {
        const idx = cursor;
        cursor += 1;
        if (idx >= args.iterations) {
          return;
        }
        const message = SAMPLE_MESSAGES[idx % SAMPLE_MESSAGES.length]!;
        const startedAt = performance.now();
        try {
          const r = await runCoachingTurn(
            { config, db, redis, rateLimiters, traceEmitter },
            {
              userId: asUserId(u.userId),
              phoneE164: asPhoneE164(phone),
              phoneHash: u.phoneHash,
              body: message,
              mediaUrls: [],
              inboundMessageId: `lat-${Date.now()}-${idx}`,
              receivedAt: new Date(),
              traceId: `lat-${idx}`,
            },
          );
          const finishedAt = performance.now();
          const latencyMs = finishedAt - startedAt;
          samples.push({
            startedAt,
            finishedAt,
            latencyMs,
            endEvent: r.endEvent,
            withinBudget: latencyMs <= 6000,
          });
        } catch (err) {
          const finishedAt = performance.now();
          samples.push({
            startedAt,
            finishedAt,
            latencyMs: finishedAt - startedAt,
            endEvent: `error:${err instanceof Error ? err.name : 'unknown'}`,
            withinBudget: false,
          });
        }
      }
    }

    await Promise.all(Array.from({ length: args.concurrency }, () => worker()));
    const wallMs = performance.now() - t0Wall;

    const latencies = samples.map((s) => s.latencyMs).sort((a, b) => a - b);
    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);
    const max = latencies.length > 0 ? latencies[latencies.length - 1]! : 0;
    const withinBudget = samples.filter((s) => s.withinBudget).length;
    const errors = samples.filter((s) => s.endEvent.startsWith('error:')).length;

    console.log(`\n--- results ---`);
    console.log(`samples            : ${samples.length}`);
    console.log(`wall time          : ${wallMs.toFixed(0)} ms`);
    console.log(`throughput         : ${((samples.length / wallMs) * 1000).toFixed(2)} turns/s`);
    console.log(
      `p50 / p95 / p99    : ${p50.toFixed(0)} / ${p95.toFixed(0)} / ${p99.toFixed(0)} ms`,
    );
    console.log(`max                : ${max.toFixed(0)} ms`);
    console.log(`within 6000ms p99  : ${withinBudget}/${samples.length}`);
    console.log(`errors             : ${errors}`);

    await recordEvidence({
      testId: `phase-10/latency-profile/${args.scenario.toLowerCase()}-${args.concurrency}c-${args.iterations}n`,
      controlId: `T4.Latency.${args.scenario}_${args.concurrency}c`,
      tier: 'T4',
      outcome: p99 <= 6000 && errors === 0 ? 'pass' : 'fail',
      description: `Latency profile run: ${args.iterations} iterations × ${args.concurrency}-concurrent. Budget: p99 ≤ 6000ms.`,
      details: {
        scenario: args.scenario,
        concurrency: args.concurrency,
        iterations: args.iterations,
        liveSend: args.send !== undefined,
        wallMs: Math.round(wallMs),
        p50Ms: Math.round(p50),
        p95Ms: Math.round(p95),
        p99Ms: Math.round(p99),
        maxMs: Math.round(max),
        withinBudget,
        errors,
        errorEvents: samples.filter((s) => s.endEvent.startsWith('error:')).map((s) => s.endEvent),
      },
    });

    console.log(
      `\noverall: ${p99 <= 6000 && errors === 0 ? 'PASS' : 'FAIL'} (p99=${p99.toFixed(0)}ms vs 6000ms budget)`,
    );

    if (p99 > 6000) {
      console.log('\n--- mitigations to consider per master plan §10.4 ---');
      console.log('  (a) Run QC LLM evaluations in parallel with primary LLM call');
      console.log('  (b) Use Groq Llama 3.3 70B for simple intents');
      console.log('  (c) Reduce default memory retrieval from top-5 to top-3');
      console.log('  (d) Skip QC checks 3, 4, 7 on happy-path responses');
    }

    if (p99 > 6000 || errors > 0) {
      process.exit(1);
    }
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error('profile-latency fatal:', err);
  process.exit(1);
});
