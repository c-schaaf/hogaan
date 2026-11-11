import type { Database } from '../shared/db/client.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { isEnabled } from '../shared/flags/index.js';
import { runBriefUpdate } from '../leader-context/updater.js';
import type { JobHandlers } from './runner.js';
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
      const res = await runBriefUpdate(config, db, { userId, sessionId });
      await afterBriefUpdate(config, db, userId, sessionId, res.moments ?? []);
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
