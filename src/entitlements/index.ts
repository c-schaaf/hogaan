import type { Database } from '../shared/db/client.js';
import { isEnabled } from '../shared/flags/index.js';
import type { AppConfig } from '../shared/secrets/config.js';

/**
 * P4.2 — every entitlement decision is made here, in one place.
 *
 * Capabilities a plan can grant. While FEATURE_BILLING is off there are no
 * plans, so every capability is granted (today's behaviour: everything is
 * free and unlimited). Phase 4 fills in the plan logic.
 */
export type Capability = 'mcp' | 'followUps' | 'connections' | 'unlimitedSessions';

export async function hasCapability(
  config: AppConfig,
  _db: Database,
  _userId: string,
  _cap: Capability,
): Promise<boolean> {
  if (!isEnabled(config, 'billing')) return true;
  return Promise.resolve(true);
}
