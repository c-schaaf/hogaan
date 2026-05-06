import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../src/shared/db/client.js';
import { libraryVersions } from '../src/shared/db/schema/library-versions.js';
import { loadConfig } from '../src/shared/secrets/config.js';

async function main(): Promise<void> {
  const { db, close } = getDb(loadConfig());
  try {
    const rows = await db
      .select({
        libraryName: libraryVersions.libraryName,
        version: libraryVersions.version,
        hash: libraryVersions.hash,
        publishedAt: libraryVersions.publishedAt,
        publishedBy: libraryVersions.publishedBy,
        notes: libraryVersions.notes,
      })
      .from(libraryVersions)
      .where(eq(libraryVersions.active, true));
    for (const r of rows) {
      console.log(
        `${r.libraryName.padEnd(20)} ${r.version.padEnd(5)} hash=${r.hash.slice(0, 12)}... by=${r.publishedBy ?? '?'}`,
      );
    }
  } finally {
    await close();
  }
  void and;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
