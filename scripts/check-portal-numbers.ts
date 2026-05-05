import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { upsertSponsorUser } from '../src/sponsor-portal/auth/magic-link.js';
import {
  loadCrisisCategoryCounts,
  loadEngagementSummary,
  loadPracticeDistribution,
  loadQcSummary,
  loadRetentionCurve,
  loadSeatsOverview,
} from '../src/sponsor-portal/index.js';
import { listSponsorCohortIds } from '../src/sponsor-portal/aggregation/cohort.js';
import { getDb } from '../src/shared/db/client.js';
import { sponsors } from '../src/shared/db/schema/sponsors.js';
import { loadConfig } from '../src/shared/secrets/config.js';

/**
 * Sanity-check what numbers the sponsor_admin sees on the portal after
 * seeding. Runs the same aggregation queries the routes do; prints
 * whether each segment is suppressed.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const { db, close } = getDb(config);
  try {
    const sp = await db
      .select({ id: sponsors.id })
      .from(sponsors)
      .where(eq(sponsors.legalName, 'Test Sponsor'))
      .limit(1);
    if (sp[0] === undefined) {
      throw new Error('Test Sponsor missing');
    }
    const sponsorId = sp[0].id;
    void (await upsertSponsorUser(db, {
      email: 'check@hogaan-test.local',
      role: 'sponsor_admin',
      sponsorId,
    }));
    const cohortIds = await listSponsorCohortIds(db, sponsorId);
    console.log(`sponsor=${sponsorId} cohorts=${cohortIds.length}`);

    const [seats, eng, ret, prac, qc, crisis] = await Promise.all([
      loadSeatsOverview(db, cohortIds),
      loadEngagementSummary(db, cohortIds),
      loadRetentionCurve(db, cohortIds),
      loadPracticeDistribution(db, cohortIds),
      loadQcSummary(db, cohortIds),
      loadCrisisCategoryCounts(db, cohortIds),
    ]);

    console.log('\n--- DASHBOARD ---');
    for (const s of seats) {
      console.log(
        `  cohort="${s.cohortName}" seats=${s.seatCount} redeemed=${s.redeemed} unredeemed=${s.unredeemed} rate=${(s.redemptionRate * 100).toFixed(1)}%`,
      );
    }

    console.log('\n--- ENGAGEMENT ---');
    if (eng.suppressed) {
      console.log('  summary: SUPPRESSED');
    } else {
      console.log(
        `  summary: redeemed=${eng.value.redeemedSeats} active=${eng.value.activeDistinctUsers} (${(eng.value.activePct * 100).toFixed(1)}%) sessions=${eng.value.totalSessions} turns=${eng.value.totalTurns} medianSession=${eng.value.medianSessionLengthTurns}`,
      );
    }
    if (ret.suppressed) {
      console.log('  retention: SUPPRESSED');
    } else {
      console.log(`  retention curve:`);
      for (const p of ret.value) {
        console.log(
          `    week ${p.weekIndex}: ${p.activeUsers} users (${(p.pct * 100).toFixed(1)}%)`,
        );
      }
    }
    if (prac.suppressed) {
      console.log('  practices: SUPPRESSED');
    } else {
      console.log(`  practice distribution (${prac.value.length} above floor):`);
      for (const p of prac.value.sort((a, b) => b.turnCount - a.turnCount)) {
        console.log(
          `    ${p.practice.padEnd(15)} turns=${p.turnCount} distinctUsers=${p.distinctUsers}`,
        );
      }
    }

    console.log('\n--- QC ---');
    if (qc.suppressed) {
      console.log('  qc: SUPPRESSED');
    } else {
      console.log(
        `  qc: total=${qc.value.totalTurns} approved=${qc.value.approvedTurns} passRate=${(qc.value.passRate * 100).toFixed(1)}% degraded=${qc.value.degradedTurns} retryRate=${(qc.value.retryRate * 100).toFixed(1)}%`,
      );
    }
    if (crisis.suppressed) {
      console.log('  crisis: SUPPRESSED');
    } else {
      console.log(`  crisis events:`);
      for (const c of crisis.value) {
        console.log(`    ${c.category.padEnd(28)} ${c.count}`);
      }
    }
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
