import type { Database } from '../shared/db/client.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { isEnabled } from '../shared/flags/index.js';
import { runBriefUpdate } from '../leader-context/updater.js';
import { eq } from 'drizzle-orm';
import { sessions } from '../shared/db/schema/sessions.js';
import { type JobHandlers, RescheduleJob } from './runner.js';
import { phase2JobHandlers } from './phase2-handlers.js';

/**
 * Job kind -> handler. Each handler re-checks its feature flag, so turning a
 * flag off also stops queued work for it.
 */
export function buildJobHandlers(config: AppConfig, db: Database): JobHandlers {
  return {
    'brief.update': async (payload) => {
      if (!isEnabled(config, 'leaderBrief')) return;
      const userId = String(payload['userId']);
      const sessionId = String(payload['sessionId']);
      const startedAt = new Date();
      const res = await runBriefUpdate(config, db, { userId, sessionId });
      await afterBriefUpdate(config, db, userId, sessionId, res.moments ?? []);
      // New turns arrived while this ran (their re-schedule could not touch a
      // running job): run again once the leader goes quiet.
      const s = (
        await db
          .select({ lastTurnAt: sessions.lastTurnAt })
          .from(sessions)
          .where(eq(sessions.id, sessionId))
          .limit(1)
      )[0];
      if (s !== undefined && s.lastTurnAt.getTime() > startedAt.getTime()) {
        throw new RescheduleJob(
          new Date(Date.now() + (config.briefUpdateDelayMs ?? 600_000)),
          'new-turns',
        );
      }
    },
    ...phase2JobHandlers(config, db),
  };
}

/** Hook for Phase 2 (moments extracted from the same background call). */
async function afterBriefUpdate(
  config: AppConfig,
  db: Database,
  userId: string,
  sessionId: string,
  moments: { what: string; withWhom: string; when: string | null }[],
): Promise<void> {
  const { recordExtractedMoments } = await import('../moments/store.js');
  if (!isEnabled(config, 'moments')) return;
  await recordExtractedMoments(config, db, userId, sessionId, moments);
}

/** True when any feature that needs the job runner is on. */
export function jobRunnerNeeded(config: AppConfig): boolean {
  return (
    isEnabled(config, 'leaderBrief') ||
    isEnabled(config, 'moments') ||
    isEnabled(config, 'followUpEmail') ||
    isEnabled(config, 'weeklyNudge')
  );
}
