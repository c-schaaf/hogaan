import 'dotenv/config';
import {
  crisisResourcesV2,
  getActiveLibraryVersions,
  publishLibraryVersion,
  resetResolverForTests,
  verifyIntegrity,
} from '../src/libraries/index.js';
import { getDb } from '../src/shared/db/client.js';
import { loadConfig } from '../src/shared/secrets/config.js';

/**
 * Publish crisis_resources v2 with the confirmed Tabaha number
 * (+254 722 178 177) replacing the v1 placeholder.
 *
 * `makeActive: true` runs the demote-v1 + promote-v2 transaction atomically
 * inside publishLibraryVersion. After publish we re-resolve the active set
 * and run verifyIntegrity() to confirm the stored hash matches a fresh
 * canonical hash of the v2 payload.
 *
 * Approved by ops 2026-05-04.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const { db, close } = getDb(config);

  const result = await publishLibraryVersion(db, {
    libraryName: 'crisis_resources',
    version: 'v2',
    payload: crisisResourcesV2,
    publishedBy: 'ops@hogaan-team:tabaha-confirmed-2026-05-04',
    notes:
      'Tabaha phone +254 722 178 177 confirmed by ops 2026-05-04. v1 demoted ' +
      'to active=false. Phase 2 geo-aware expansion remains deferred.',
    makeActive: true,
  });

  console.log(
    `crisis_resources@v2 hash=${result.hash.slice(0, 12)} active=${result.active} alreadyExisted=${result.alreadyExisted}`,
  );

  // Force a fresh resolve so the cache reflects the new active version, then
  // verify the stored hash against a fresh canonical hash of the payload.
  resetResolverForTests();
  const resolved = await getActiveLibraryVersions(db);
  console.log(
    `resolver active crisis_resources: version=${resolved.crisisResources.version} hash=${resolved.crisisResources.hash.slice(0, 12)}`,
  );
  verifyIntegrity(resolved);
  console.log('verifyIntegrity: OK — all 5 active library hashes match canonical recomputation.');

  await close();
}

main().catch((err: unknown) => {
  console.error('crisis_resources v2 publish failed:', err);
  process.exit(1);
});
