import { eq } from 'drizzle-orm';
import type { Database } from '../shared/db/client.js';
import { libraryVersions } from '../shared/db/schema/library-versions.js';
import { canonicalHash, canonicalStringify } from './hash.js';
import { invalidateLibraryCache } from './resolver.js';

export type LibraryName =
  | 'prompt_templates'
  | 'voice_rules'
  | 'cultural_framing'
  | 'crisis_resources'
  | 'scenarios';

export interface PublishOptions {
  libraryName: LibraryName;
  version: string;
  payload: unknown;
  publishedBy: string;
  notes?: string;
  /** When true, also flips this row's active=true and demotes any prior active row. */
  makeActive: boolean;
}

export interface PublishResult {
  libraryName: LibraryName;
  version: string;
  hash: string;
  active: boolean;
  alreadyExisted: boolean;
}

/**
 * Insert a new library version. If a row with (library_name, version) already
 * exists with the same canonical hash, this is idempotent — used by seed
 * scripts. If the existing row has a different hash, fail loudly.
 *
 * makeActive=true does the demote+promote in a single transaction so the
 * resolver never sees zero or two active rows for one library.
 */
export async function publishLibraryVersion(
  db: Database,
  opts: PublishOptions,
): Promise<PublishResult> {
  const hash = canonicalHash(opts.payload);
  // Drizzle stringifies JSONB internally, but storing the canonical form keeps
  // the on-disk content consistent with the hash.
  const canonicalPayload = JSON.parse(canonicalStringify(opts.payload)) as object;

  const existing = await db
    .select()
    .from(libraryVersions)
    .where(eq(libraryVersions.libraryName, opts.libraryName))
    .then((rows) => rows.filter((r) => r.version === opts.version));

  if (existing.length > 1) {
    throw new Error(
      `corrupt state: ${existing.length} rows for ${opts.libraryName}@${opts.version}`,
    );
  }

  if (existing.length === 1) {
    const row = existing[0]!;
    if (row.hash !== hash) {
      throw new Error(
        `${opts.libraryName}@${opts.version} exists with different content: ` +
          `stored=${row.hash.slice(0, 12)}... new=${hash.slice(0, 12)}... — bump version instead of editing in place`,
      );
    }
    if (opts.makeActive && !row.active) {
      await activateExisting(db, row.id, opts.libraryName);
    }
    invalidateLibraryCache();
    return {
      libraryName: opts.libraryName,
      version: opts.version,
      hash,
      active: opts.makeActive || row.active,
      alreadyExisted: true,
    };
  }

  if (opts.makeActive) {
    await db.transaction(async (tx) => {
      await tx
        .update(libraryVersions)
        .set({ active: false })
        .where(eq(libraryVersions.libraryName, opts.libraryName));
      await tx.insert(libraryVersions).values({
        libraryName: opts.libraryName,
        version: opts.version,
        payload: canonicalPayload,
        hash,
        active: true,
        publishedBy: opts.publishedBy,
        ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
      });
    });
  } else {
    await db.insert(libraryVersions).values({
      libraryName: opts.libraryName,
      version: opts.version,
      payload: canonicalPayload,
      hash,
      active: false,
      publishedBy: opts.publishedBy,
      ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
    });
  }

  invalidateLibraryCache();
  return {
    libraryName: opts.libraryName,
    version: opts.version,
    hash,
    active: opts.makeActive,
    alreadyExisted: false,
  };
}

async function activateExisting(db: Database, id: string, libraryName: LibraryName): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(libraryVersions)
      .set({ active: false })
      .where(eq(libraryVersions.libraryName, libraryName));
    await tx.update(libraryVersions).set({ active: true }).where(eq(libraryVersions.id, id));
  });
}
