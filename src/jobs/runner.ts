import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { reportP2 } from '../incident-handling/index.js';
import type { Database } from '../shared/db/client.js';
import { backgroundJobs, type BackgroundJobRow } from '../shared/db/schema/background-jobs.js';
import type { AppConfig } from '../shared/secrets/config.js';

/**
 * P2.5 — background job runner, inside the existing stack (Postgres-backed;
 * runs in the web process on an interval, so no new service is needed).
 *
 * Properties the plan asks for:
 *   - Idempotent: enqueue is keyed by a unique `dedupe_key`. `mode: 'once'`
 *     never re-runs a key (emails); `mode: 'replace'` re-arms a pending or
 *     finished key with a new run time (debounced brief updates).
 *   - Traced: every run logs a structured `job-trace` line (kind, outcome,
 *     attempts, latency) — no payload contents, no PII.
 *   - Fail-open: a handler error is caught, recorded, retried with backoff
 *     (3 attempts), then marked failed with a P2. It never reaches the chat
 *     turn, which only ever *enqueues* (and swallows enqueue errors too).
 *   - Multi-instance safe: a job is claimed with a conditional UPDATE
 *     (status pending -> running), so two instances cannot both run it.
 */

export type JobHandler = (payload: Record<string, unknown>, job: BackgroundJobRow) => Promise<void>;
export type JobHandlers = Record<string, JobHandler>;

export interface EnqueueOptions {
  kind: string;
  dedupeKey: string;
  payload?: Record<string, unknown>;
  runAfter?: Date;
  /** 'once' (default): never re-run a key. 'replace': re-arm with new runAfter/payload. */
  mode?: 'once' | 'replace';
}

const MAX_ATTEMPTS = 3;
const STALE_RUNNING_MS = 10 * 60_000;

export async function enqueueJob(db: Database, opts: EnqueueOptions): Promise<void> {
  const values = {
    kind: opts.kind,
    dedupeKey: opts.dedupeKey,
    payload: opts.payload ?? {},
    runAfter: opts.runAfter ?? new Date(),
  };
  if (opts.mode === 'replace') {
    await db
      .insert(backgroundJobs)
      .values(values)
      .onConflictDoUpdate({
        target: backgroundJobs.dedupeKey,
        set: {
          payload: values.payload,
          runAfter: values.runAfter,
          status: 'pending',
          attempts: 0,
          lastError: null,
          updatedAt: new Date(),
        },
        // Never disturb a job another worker is running right now.
        setWhere: sql`${backgroundJobs.status} <> 'running'`,
      });
  } else {
    await db.insert(backgroundJobs).values(values).onConflictDoNothing({
      target: backgroundJobs.dedupeKey,
    });
  }
}

/** Fail-open enqueue for request handlers: never throws. */
export function enqueueJobSafe(db: Database, opts: EnqueueOptions): void {
  void enqueueJob(db, opts).catch((err: unknown) => {
    reportP2('background job enqueue failed (fail-open)', {
      source: 'Jobs.Enqueue',
      extra: { kind: opts.kind, error: err instanceof Error ? err.message : String(err) },
    });
  });
}

export async function cancelJob(db: Database, dedupeKey: string): Promise<void> {
  await db
    .update(backgroundJobs)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(backgroundJobs.dedupeKey, dedupeKey), eq(backgroundJobs.status, 'pending')));
}

function trace(row: BackgroundJobRow, outcome: string, ms: number): void {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      kind: 'job-trace',
      jobKind: row.kind,
      jobId: row.id,
      outcome,
      attempts: row.attempts,
      latencyMs: ms,
    }),
  );
}

/**
 * Claim and run every due job once. Returns how many ran. Used by the
 * interval runner, by tests, and by demo mode's "run now" control.
 */
export async function runDueJobs(
  db: Database,
  handlers: JobHandlers,
  opts: { now?: Date; limit?: number; quiet?: boolean } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  // Recover jobs left 'running' by a crashed process.
  await db
    .update(backgroundJobs)
    .set({ status: 'pending', updatedAt: now })
    .where(
      and(
        eq(backgroundJobs.status, 'running'),
        lte(backgroundJobs.updatedAt, new Date(now.getTime() - STALE_RUNNING_MS)),
      ),
    );
  const due = await db
    .select({ id: backgroundJobs.id })
    .from(backgroundJobs)
    .where(and(eq(backgroundJobs.status, 'pending'), lte(backgroundJobs.runAfter, now)))
    .orderBy(backgroundJobs.runAfter)
    .limit(opts.limit ?? 10);
  if (due.length === 0) return 0;
  const claimed = await db
    .update(backgroundJobs)
    .set({
      status: 'running',
      attempts: sql`${backgroundJobs.attempts} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        inArray(
          backgroundJobs.id,
          due.map((d) => d.id),
        ),
        eq(backgroundJobs.status, 'pending'),
      ),
    )
    .returning();
  for (const job of claimed) {
    const t0 = Date.now();
    const handler = handlers[job.kind];
    try {
      if (handler === undefined) throw new Error(`no handler for job kind ${job.kind}`);
      await handler(job.payload as Record<string, unknown>, job);
      await db
        .update(backgroundJobs)
        .set({ status: 'done', finishedAt: new Date(), updatedAt: new Date(), lastError: null })
        .where(and(eq(backgroundJobs.id, job.id), eq(backgroundJobs.status, 'running')));
      if (opts.quiet !== true) trace(job, 'done', Date.now() - t0);
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      const final = job.attempts >= MAX_ATTEMPTS;
      const backoffMs = 60_000 * 2 ** (job.attempts - 1);
      await db
        .update(backgroundJobs)
        .set({
          status: final ? 'failed' : 'pending',
          runAfter: new Date(Date.now() + backoffMs),
          lastError: message,
          updatedAt: new Date(),
          ...(final ? { finishedAt: new Date() } : {}),
        })
        .where(eq(backgroundJobs.id, job.id));
      if (opts.quiet !== true) trace(job, final ? 'failed' : 'retry', Date.now() - t0);
      if (final) {
        reportP2('background job failed after retries', {
          source: 'Jobs.Runner',
          extra: { kind: job.kind, jobId: job.id, error: message },
        });
      }
    }
  }
  return claimed.length;
}

export interface JobRunner {
  stop(): void;
}

/** Start the interval runner. Ticks never overlap; errors are swallowed. */
export function startJobRunner(config: AppConfig, db: Database, handlers: JobHandlers): JobRunner {
  const interval = config.jobPollIntervalMs ?? 15_000;
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    runDueJobs(db, handlers)
      .catch((err: unknown) => {
        reportP2('job runner tick failed', {
          source: 'Jobs.Runner',
          extra: { error: err instanceof Error ? err.message : String(err) },
        });
      })
      .finally(() => {
        busy = false;
      });
  }, interval);
  if (typeof timer.unref === 'function') timer.unref();
  return { stop: () => clearInterval(timer) };
}
