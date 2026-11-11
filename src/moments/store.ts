import type { Database } from '../shared/db/client.js';
import type { AppConfig } from '../shared/secrets/config.js';

/** P2.1 — filled in by Phase 2. */
export async function recordExtractedMoments(
  _config: AppConfig,
  _db: Database,
  _userId: string,
  _sessionId: string,
  _moments: { what: string; withWhom: string; when: string | null }[],
): Promise<void> {
  await Promise.resolve();
}
