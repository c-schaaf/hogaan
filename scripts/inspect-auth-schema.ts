import 'dotenv/config';
import postgres from 'postgres';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL not set');
  const sql = postgres(url, { prepare: false, max: 2, idle_timeout: 5, connect_timeout: 10 });
  try {
    interface Col {
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }
    const users = await sql<Col[]>`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'users'
      ORDER BY ordinal_position
    `;
    console.log('--- auth.users ---');
    for (const c of users) {
      console.log(
        `  ${c.column_name.padEnd(35)} ${c.data_type.padEnd(30)} ${
          c.is_nullable === 'NO' ? 'NOT NULL' : 'nullable'
        }${c.column_default ? ` default ${c.column_default}` : ''}`,
      );
    }

    const identities = await sql<Col[]>`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'identities'
      ORDER BY ordinal_position
    `;
    console.log('\n--- auth.identities ---');
    for (const c of identities) {
      console.log(
        `  ${c.column_name.padEnd(35)} ${c.data_type.padEnd(30)} ${
          c.is_nullable === 'NO' ? 'NOT NULL' : 'nullable'
        }${c.column_default ? ` default ${c.column_default}` : ''}`,
      );
    }

    // Inspect the actual data of the demo user row
    const row = await sql<Record<string, unknown>[]>`
      SELECT * FROM auth.users WHERE email = 'demo@hogaan.com' LIMIT 1
    `;
    if (row[0]) {
      console.log('\n--- demo@hogaan.com row ---');
      for (const [k, v] of Object.entries(row[0])) {
        const display =
          v === null
            ? '<NULL>'
            : v instanceof Date
              ? v.toISOString()
              : typeof v === 'object'
                ? JSON.stringify(v)
                : String(v).slice(0, 80);
        console.log(`  ${k.padEnd(35)} ${display}`);
      }
    } else {
      console.log('\n(no demo@hogaan.com row)');
    }
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
