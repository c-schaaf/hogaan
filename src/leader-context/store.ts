import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../shared/db/client.js';
import { decryptPlaintext, encryptPlaintext } from '../shared/db/encryption.js';
import { leaderBriefs } from '../shared/db/schema/leader-briefs.js';
import { stripPii } from '../shared/pii/filter.js';
import type { AppConfig } from '../shared/secrets/config.js';
import {
  type BriefDoc,
  type BriefLine,
  emptyBrief,
  type LeaderBrief,
  type LineSource,
  MAX_FIELD_CHARS,
  MAX_LINE_CHARS,
  MAX_LINES,
  PROFILE_FIELD_KEYS,
  type ProfileFields,
} from './types.js';

function enc(config: AppConfig, value: unknown): string {
  return encryptPlaintext(config, JSON.stringify(value));
}

function dec<T>(config: AppConfig, cipher: string | null, fallback: T): T {
  if (cipher === null || cipher === '') return fallback;
  return JSON.parse(decryptPlaintext(config, cipher)) as T;
}

export async function getBrief(
  config: AppConfig,
  db: Database,
  userId: string,
): Promise<LeaderBrief> {
  const rows = await db.select().from(leaderBriefs).where(eq(leaderBriefs.userId, userId)).limit(1);
  const r = rows[0];
  if (r === undefined) return emptyBrief();
  return {
    profileFields: dec<ProfileFields>(config, r.profileFieldsEncrypted, {}),
    profile: dec<BriefLine[]>(config, r.profileEncrypted, []),
    goals: dec<BriefLine[]>(config, r.goalsEncrypted, []),
    notes: dec<BriefLine[]>(config, r.notesEncrypted, []),
    version: r.version,
    updatedAt: r.updatedAt.toISOString(),
    updatedBy: r.updatedBy,
  };
}

/** Normalize, PII-filter and cap one line of text. Empty -> null. */
export function cleanLine(text: string, knownSurnames: readonly string[] = []): string | null {
  const t = stripPii(text.replace(/\s+/g, ' ').trim(), { knownSurnames }).slice(0, MAX_LINE_CHARS);
  return t.length === 0 ? null : t;
}

export function cleanFields(
  fields: Partial<Record<keyof ProfileFields, unknown>>,
  knownSurnames: readonly string[] = [],
): ProfileFields {
  const out: ProfileFields = {};
  for (const k of PROFILE_FIELD_KEYS) {
    const v = fields[k];
    if (typeof v !== 'string') continue;
    const t = stripPii(v.replace(/\s+/g, ' ').trim(), { knownSurnames }).slice(0, MAX_FIELD_CHARS);
    if (t.length > 0) out[k] = t;
  }
  return out;
}

export function newLine(text: string, source: LineSource): BriefLine {
  return { id: randomUUID(), text, source, updatedAt: new Date().toISOString() };
}

/**
 * Saves the brief. With `expectedVersion`, the write only happens if the
 * stored version is still the one that was read (optimistic concurrency),
 * so a slow background update can never overwrite an edit or a "delete
 * everything" the leader made meanwhile. Returns false when it did not write.
 */
export async function saveBrief(
  config: AppConfig,
  db: Database,
  userId: string,
  brief: LeaderBrief,
  meta: { updatedBy: string; lastSessionId?: string | null; expectedVersion?: number },
): Promise<boolean> {
  const capped: LeaderBrief = {
    ...brief,
    profile: brief.profile.slice(-MAX_LINES.profile),
    goals: brief.goals.slice(-MAX_LINES.goals),
    notes: brief.notes.slice(-MAX_LINES.notes),
  };
  const values = {
    userId,
    profileFieldsEncrypted: enc(config, capped.profileFields),
    profileEncrypted: enc(config, capped.profile),
    goalsEncrypted: enc(config, capped.goals),
    notesEncrypted: enc(config, capped.notes),
    version: brief.version + 1,
    updatedBy: meta.updatedBy,
    updatedAt: new Date(),
    ...(meta.lastSessionId !== undefined ? { lastSessionId: meta.lastSessionId } : {}),
  };
  if (meta.expectedVersion === undefined) {
    await db
      .insert(leaderBriefs)
      .values(values)
      .onConflictDoUpdate({ target: leaderBriefs.userId, set: values });
    return true;
  }
  if (meta.expectedVersion === 0) {
    const ins = await db
      .insert(leaderBriefs)
      .values(values)
      .onConflictDoNothing()
      .returning({ v: leaderBriefs.version });
    return ins[0] !== undefined;
  }
  const upd = await db
    .update(leaderBriefs)
    .set(values)
    .where(and(eq(leaderBriefs.userId, userId), eq(leaderBriefs.version, meta.expectedVersion)))
    .returning({ v: leaderBriefs.version });
  return upd[0] !== undefined;
}

/**
 * "Delete everything": wipes every line and field but keeps a versioned,
 * empty record, so an in-flight background update cannot write old lines back.
 */
export async function deleteBrief(config: AppConfig, db: Database, userId: string): Promise<void> {
  const current = await getBrief(config, db, userId);
  const empty = emptyBrief();
  empty.version = current.version;
  await saveBrief(config, db, userId, empty, { updatedBy: 'leader' });
}

/** Find which document holds a line id. */
export function findLine(brief: LeaderBrief, id: string): { doc: BriefDoc; index: number } | null {
  for (const doc of ['profile', 'goals', 'notes'] as const) {
    const index = brief[doc].findIndex((l) => l.id === id);
    if (index >= 0) return { doc, index };
  }
  return null;
}

/** Append a line to a document (used by reflections, MCP save_note, the leader). */
export async function appendLine(
  config: AppConfig,
  db: Database,
  userId: string,
  doc: BriefDoc,
  text: string,
  source: LineSource,
  knownSurnames: readonly string[] = [],
): Promise<BriefLine | null> {
  const cleaned = cleanLine(text, knownSurnames);
  if (cleaned === null) return null;
  const brief = await getBrief(config, db, userId);
  const line = newLine(cleaned, source);
  brief[doc] = [...brief[doc], line];
  await saveBrief(config, db, userId, brief, {
    updatedBy: source === 'leader' ? 'leader' : source,
  });
  return line;
}
