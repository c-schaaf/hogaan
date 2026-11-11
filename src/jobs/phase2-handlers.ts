import type { Database } from '../shared/db/client.js';
import type { AppConfig } from '../shared/secrets/config.js';
import type { JobHandlers } from './runner.js';

/** Phase 2 job handlers (follow-up email, weekly nudge). Filled in by P2. */
export function phase2JobHandlers(_config: AppConfig, _db: Database): JobHandlers {
  return {};
}
