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
  | 'scenarios'
  | 'daily_prompts';

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

export interface SignoffOptions {
  libraryName: LibraryName;
  version: string;
  /** Sign-off attribution. Format: "<name>:signed-off-<YYYY-MM-DD>". */
  signedBy: string;
  /** Free-form attestation note appended to the existing notes. */
  attestation: string;
}

/**
 * Record a sign-off on an EXISTING (libraryName, version) row by updating
 * `published_by` and appending to `notes`. Does NOT touch `payload` or `hash`
 * — content immutability is preserved. Idempotent: re-running with the same
 * signedBy is a no-op.
 *
 * Use this when content was published earlier with a placeholder author
 * (e.g. `system:seed-script`) and an authority later attests to it.
 */
export async function recordSignoff(
  db: Database,
  opts: SignoffOptions,
): Promise<{ libraryName: LibraryName; version: string; alreadySignedOff: boolean }> {
  const rows = await db
    .select()
    .from(libraryVersions)
    .where(eq(libraryVersions.libraryName, opts.libraryName))
    .then((all) => all.filter((r) => r.version === opts.version));

  if (rows.length === 0) {
    throw new Error(`cannot record sign-off: ${opts.libraryName}@${opts.version} does not exist`);
  }
  const row = rows[0]!;

  if (row.publishedBy === opts.signedBy) {
    return { libraryName: opts.libraryName, version: opts.version, alreadySignedOff: true };
  }

  const existingNotes = row.notes ?? '';
  const newNotes =
    existingNotes.length === 0
      ? opts.attestation
      : `${existingNotes}\n--- ${opts.signedBy} ---\n${opts.attestation}`;

  await db
    .update(libraryVersions)
    .set({ publishedBy: opts.signedBy, notes: newNotes })
    .where(eq(libraryVersions.id, row.id));

  return { libraryName: opts.libraryName, version: opts.version, alreadySignedOff: false };
}
