import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '../src/shared/db/client.js';
import { loadConfig } from '../src/shared/secrets/config.js';

async function main(): Promise<void> {
  const { db, close } = getDb(loadConfig());
  try {
    const userCount = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from users where status = 'onboarded' and cohort_id is not null
    `);
    const sessCount = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from sessions s
      join users u on u.id = s.user_id
      where u.status = 'onboarded'
    `);
    const turnCount = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from turns t
      join users u on u.id = t.user_id
      where u.status = 'onboarded'
    `);
    const crisisCount = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from crisis_events
      where error_reason like 'realistic-cohort-seed-v1%'
    `);
    console.log(
      JSON.stringify(
        {
          users: userCount[0]?.n,
          sessions: sessCount[0]?.n,
          turns: turnCount[0]?.n,
          crisis_events: crisisCount[0]?.n,
        },
        null,
        2,
      ),
    );
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
