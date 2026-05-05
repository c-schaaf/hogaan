import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { upsertSponsorUser } from '../src/sponsor-portal/auth/magic-link.js';
import { getDb } from '../src/shared/db/client.js';
import { cohorts } from '../src/shared/db/schema/cohorts.js';
import { sponsors } from '../src/shared/db/schema/sponsors.js';
import { loadConfig } from '../src/shared/secrets/config.js';

/**
 * One-off seed: provisions a single sponsor + cohort + sponsor_admin so a
 * sponsor can sign into the portal.
 *
 * Idempotent — re-running with the same env values returns the existing IDs
 * without creating duplicates.
 *
 * Usage (template form — committed):
 *
 *   SPONSOR_ADMIN_EMAIL=admin@example.com pnpm exec tsx scripts/seed-test-sponsor.ts
 *
 * Optional overrides:
 *   SPONSOR_LEGAL_NAME      (default: "Test Sponsor")
 *   SPONSOR_COHORT_NAME     (default: "Test Cohort")
 *   SPONSOR_SEAT_COUNT      (default: 100)
 *   SPONSOR_GEOGRAPHY       (default: "Mogadishu")
 *
 * The committed file deliberately uses placeholder defaults — real
 * email + sponsor name flow through env vars at run time.
 */

const DEFAULT_LEGAL_NAME = 'Test Sponsor';
const DEFAULT_COHORT_NAME = 'Test Cohort';
const DEFAULT_GEOGRAPHY = 'Mogadishu';
const DEFAULT_SEAT_COUNT = 100;
const DEFAULT_REDEMPTION_WINDOW_DAYS = 365;
const DEFAULT_SEAT_DURATION_DAYS = 365;

async function main(): Promise<void> {
  const adminEmail = process.env['SPONSOR_ADMIN_EMAIL'];
  if (adminEmail === undefined || adminEmail === '') {
    throw new Error(
      'SPONSOR_ADMIN_EMAIL env var is required (no default — committed file is a template)',
    );
  }
  const legalName = process.env['SPONSOR_LEGAL_NAME'] ?? DEFAULT_LEGAL_NAME;
  const cohortName = process.env['SPONSOR_COHORT_NAME'] ?? DEFAULT_COHORT_NAME;
  const seatCountRaw = process.env['SPONSOR_SEAT_COUNT'];
  const seatCount =
    seatCountRaw !== undefined && seatCountRaw !== '' ? Number(seatCountRaw) : DEFAULT_SEAT_COUNT;
  const geography = process.env['SPONSOR_GEOGRAPHY'] ?? DEFAULT_GEOGRAPHY;

  const config = loadConfig();
  const { db, close } = getDb(config);

  try {
    console.log('seeding sponsor...');
    let sponsorId: string;
    const existingSponsor = await db
      .select({ id: sponsors.id })
      .from(sponsors)
      .where(eq(sponsors.legalName, legalName))
      .limit(1);
    if (existingSponsor[0] !== undefined) {
      sponsorId = existingSponsor[0].id;
      console.log(`  sponsor existed: ${sponsorId} (legal_name="${legalName}")`);
    } else {
      const ins = await db
        .insert(sponsors)
        .values({ legalName, primaryContactEmail: adminEmail })
        .returning({ id: sponsors.id });
      sponsorId = ins[0]!.id;
      console.log(`  sponsor created: ${sponsorId} (legal_name="${legalName}")`);
    }

    console.log('seeding cohort...');
    let cohortId: string;
    const existingCohort = await db
      .select({ id: cohorts.id })
      .from(cohorts)
      .where(eq(cohorts.name, cohortName))
      .limit(1);
    if (existingCohort[0] !== undefined) {
      cohortId = existingCohort[0].id;
      console.log(`  cohort existed: ${cohortId} (name="${cohortName}")`);
    } else {
      const now = new Date();
      const windowEnd = new Date(
        now.getTime() + DEFAULT_REDEMPTION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      );
      const ins = await db
        .insert(cohorts)
        .values({
          sponsorId,
          name: cohortName,
          seatCount,
          redemptionWindowStart: now,
          redemptionWindowEnd: windowEnd,
          seatDurationDays: DEFAULT_SEAT_DURATION_DAYS,
          targetGeography: geography,
        })
        .returning({ id: cohorts.id });
      cohortId = ins[0]!.id;
      console.log(`  cohort created: ${cohortId} (name="${cohortName}", seats=${seatCount})`);
    }

    console.log('seeding sponsor_user (role=sponsor_admin)...');
    const sponsorUser = await upsertSponsorUser(db, {
      email: adminEmail,
      role: 'sponsor_admin',
      sponsorId,
    });
    console.log(`  sponsor_user: ${sponsorUser.id} (email="${adminEmail}", role=sponsor_admin)`);

    console.log('\n=== summary ===');
    console.log(`sponsor_id        : ${sponsorId}`);
    console.log(`cohort_id         : ${cohortId}`);
    console.log(`sponsor_user_id   : ${sponsorUser.id}`);
    console.log(`sponsor_user_email: ${adminEmail}`);
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error('seed-test-sponsor fatal:', err);
  process.exit(1);
});
