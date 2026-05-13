import 'dotenv/config';
import postgres from 'postgres';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL not set');
  const sql = postgres(url, { prepare: false, max: 2, idle_timeout: 5, connect_timeout: 10 });
  try {
    const u = await sql<{ id: string }[]>`
      SELECT id FROM auth.users WHERE email = 'demo@hogaan.com'
    `;
    if (!u[0]) {
      console.log('no demo user in auth.users');
      return;
    }
    const id = u[0].id;
    console.log('demo user_id =', id);
    const r = await sql<Record<string, unknown>[]>`
      SELECT * FROM auth.identities WHERE user_id = ${id}::uuid
    `;
    console.log('\nidentities:', r.length);
    for (const row of r) {
      console.log(JSON.stringify(row, null, 2));
    }
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
