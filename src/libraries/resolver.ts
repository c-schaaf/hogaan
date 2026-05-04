import { and, eq } from 'drizzle-orm';
import type { LibraryVersionSet } from '../shared/types/index.js';
import type { Database } from '../shared/db/client.js';
import { libraryVersions } from '../shared/db/schema/library-versions.js';
import { canonicalHash } from './hash.js';
import type {
  CrisisResourcesPayload,
  CulturalFramingPayload,
  PromptTemplatesPayload,
  ScenariosPayload,
  VoiceRulesPayload,
} from './types.js';

export class LibraryResolverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibraryResolverError';
  }
}

export interface ResolvedLibraries {
  promptTemplates: { version: string; hash: string; payload: PromptTemplatesPayload };
  voiceRules: { version: string; hash: string; payload: VoiceRulesPayload };
  culturalFraming: { version: string; hash: string; payload: CulturalFramingPayload };
  crisisResources: { version: string; hash: string; payload: CrisisResourcesPayload };
  scenarios: { version: string; hash: string; payload: ScenariosPayload };
  resolvedAt: Date;
}

/**
 * Process #9 §2 resolver. In-process cache with a 60s TTL — cache hit is the
 * hot path (target p99 ~5ms; miss target p99 ~35ms).
 *
 * Why pin all five libraries together: a single turn must use one consistent
 * snapshot. If voice_rules v3 is active but cultural_framing v2 is fetched
 * mid-resolution, Process #9 §13 determinismHash diverges — replays will not
 * reproduce.
 */
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  resolved: ResolvedLibraries;
  expiresAt: number;
}

let cache: CacheEntry | undefined;

export async function getActiveLibraryVersions(db: Database): Promise<ResolvedLibraries> {
  const now = Date.now();
  if (cache !== undefined && cache.expiresAt > now) {
    return cache.resolved;
  }

  const rows = await db
    .select({
      libraryName: libraryVersions.libraryName,
      version: libraryVersions.version,
      payload: libraryVersions.payload,
      hash: libraryVersions.hash,
    })
    .from(libraryVersions)
    .where(eq(libraryVersions.active, true));

  const byName = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (byName.has(r.libraryName)) {
      throw new LibraryResolverError(
        `multiple active versions for library ${r.libraryName} — resolver requires exactly one`,
      );
    }
    byName.set(r.libraryName, r);
  }

  const requireRow = (
    name:
      | 'prompt_templates'
      | 'voice_rules'
      | 'cultural_framing'
      | 'crisis_resources'
      | 'scenarios',
  ): (typeof rows)[number] => {
    const row = byName.get(name);
    if (row === undefined) {
      throw new LibraryResolverError(`no active version for library ${name} — run seed-libraries`);
    }
    return row;
  };

  const resolved: ResolvedLibraries = {
    promptTemplates: castRow<PromptTemplatesPayload>(requireRow('prompt_templates')),
    voiceRules: castRow<VoiceRulesPayload>(requireRow('voice_rules')),
    culturalFraming: castRow<CulturalFramingPayload>(requireRow('cultural_framing')),
    crisisResources: castRow<CrisisResourcesPayload>(requireRow('crisis_resources')),
    scenarios: castRow<ScenariosPayload>(requireRow('scenarios')),
    resolvedAt: new Date(),
  };

  cache = { resolved, expiresAt: now + CACHE_TTL_MS };
  return resolved;
}

function castRow<T>(r: { version: string; payload: unknown; hash: string }): {
  version: string;
  hash: string;
  payload: T;
} {
  return { version: r.version, hash: r.hash, payload: r.payload as T };
}

/**
 * Project a resolved bundle to the LibraryVersionSet shape that gets pinned
 * into `turns.library_versions` for replayability.
 */
export function toVersionSet(resolved: ResolvedLibraries): LibraryVersionSet {
  return {
    promptTemplates: {
      version: resolved.promptTemplates.version,
      hash: resolved.promptTemplates.hash,
    },
    voiceRules: { version: resolved.voiceRules.version, hash: resolved.voiceRules.hash },
    culturalFraming: {
      version: resolved.culturalFraming.version,
      hash: resolved.culturalFraming.hash,
    },
    resolvedAt: resolved.resolvedAt,
  };
}

/**
 * Verify a resolved bundle's stored hashes match a fresh canonical hash of
 * each payload. Catches DB tampering and serialization drift. Use sparingly —
 * O(payload-size) per call.
 */
export function verifyIntegrity(resolved: ResolvedLibraries): void {
  for (const [name, row] of [
    ['prompt_templates', resolved.promptTemplates],
    ['voice_rules', resolved.voiceRules],
    ['cultural_framing', resolved.culturalFraming],
    ['crisis_resources', resolved.crisisResources],
    ['scenarios', resolved.scenarios],
  ] as const) {
    const expected = canonicalHash(row.payload);
    if (expected !== row.hash) {
      throw new LibraryResolverError(
        `hash mismatch for ${name}: stored=${row.hash.slice(0, 12)}... computed=${expected.slice(0, 12)}...`,
      );
    }
  }
}

export function invalidateLibraryCache(): void {
  cache = undefined;
}

/** Test/teardown only. */
export function resetResolverForTests(): void {
  cache = undefined;
}

/** Re-export for callers that want to filter by name+version explicitly. */
export { libraryVersions, and };
