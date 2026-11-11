import type { Database } from '../shared/db/client.js';
import type { AppConfig } from '../shared/secrets/config.js';

/** P5 — does this leader hold an active sponsored seat? Filled in by Phase 5. */
export async function hasSponsoredSeat(
  _config: AppConfig,
  _db: Database,
  _userId: string,
): Promise<boolean> {
  return Promise.resolve(false);
}
