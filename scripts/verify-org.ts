/**
 * Ops action: mark a sponsor organization as verified (vetted by Hogaan
 * staff). Until verified, its cohorts grant no sponsored seats and produce
 * no report. Usage: pnpm tsx scripts/verify-org.ts <organizationId>
 */
import 'dotenv/config';
import { getDb } from '../src/shared/db/client.js';
import { loadConfig } from '../src/shared/secrets/config.js';
import { verifyOrg } from '../src/orgs/store.js';

async function main(): Promise<void> {
  const id = process.argv[2];
  if (id === undefined) throw new Error('usage: verify-org.ts <organizationId>');
  const { db, close } = getDb(loadConfig());
  console.log((await verifyOrg(db, id)) ? `verified ${id}` : `no organization ${id}`);
  await close();
}
void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
