import 'dotenv/config';
import postgres from 'postgres';

const EMAIL = 'demo@hogaan.com';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL not set');
  const sql = postgres(url, { prepare: false, max: 2, idle_timeout: 5, connect_timeout: 10 });
  try {
    const ids = await sql<{ id: string }[]>`SELECT id FROM auth.users WHERE email = ${EMAIL}`;
    if (ids.length > 0) {
      const id = ids[0]!.id;
      // Cascade: identities → public.users → auth.users
      const idn = await sql`DELETE FROM auth.identities WHERE user_id = ${id}`;
      const pu = await sql`DELETE FROM users WHERE supabase_user_id = ${id}`;
      const au = await sql`DELETE FROM auth.users WHERE id = ${id}`;
      console.log(
        `cleaned ${EMAIL}: identities=${idn.count}, public.users=${pu.count}, auth.users=${au.count}`,
      );
    } else {
      console.log(`no ${EMAIL} in auth.users`);
    }
    // Orphan public.users from the old custom-magic-link flow
    const orphans = await sql<
      { email: string }[]
    >`DELETE FROM users WHERE supabase_user_id IS NULL AND email IS NOT NULL RETURNING email`;
    console.log(
      `orphan public.users deleted: ${orphans.length}`,
      orphans.map((r) => r.email),
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
