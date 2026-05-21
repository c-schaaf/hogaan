import { and, eq } from 'drizzle-orm';
import { reportP2 } from '../incident-handling/index.js';
import type { LibraryVersionSet } from '../shared/types/index.js';
import type { Database } from '../shared/db/client.js';
import { libraryVersions } from '../shared/db/schema/library-versions.js';
import { canonicalHash } from './hash.js';
import type {
  CrisisResourcesPayload,
  CulturalFramingPayload,
  DailyPromptsPayload,
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

  // SCRUM (PR 6, audit #16) — only `prompt_templates` is load-bearing on
  // the coaching path (`assembler.ts` reads only `libs.promptTemplates`).
  // The other four libraries are leftovers from the pre-unified-prompt
  // design — their payloads are not used today. Hard-requiring all five
  // on every turn means a seed gap on any new environment silently kills
  // all chat with an opaque E6_LibraryUnavailable. We now require only
  // `prompt_templates`; missing optional libraries log a P2 warning and
  // fall back to an empty payload.
  const promptTemplatesRow = byName.get('prompt_templates');
  if (promptTemplatesRow === undefined) {
    throw new LibraryResolverError(
      `no active version for library prompt_templates — run seed-libraries`,
    );
  }

  const optionalOrSynthetic = <T>(
    name: 'voice_rules' | 'cultural_framing' | 'crisis_resources' | 'scenarios',
    emptyPayload: T,
  ): { version: string; hash: string; payload: T } => {
    const row = byName.get(name);
    if (row === undefined) {
      reportP2(`library ${name} missing — falling back to empty payload`, {
        source: 'Libraries.Resolver',
        extra: { libraryName: name },
      });
      return { version: 'absent', hash: '', payload: emptyPayload };
    }
    return castRow<T>(row);
  };

  const resolved: ResolvedLibraries = {
    promptTemplates: castRow<PromptTemplatesPayload>(promptTemplatesRow),
    voiceRules: optionalOrSynthetic<VoiceRulesPayload>('voice_rules', {
      rules: [],
      heroPhraseFlags: [],
      usefulToSocietyPatterns: [],
    }),
    culturalFraming: optionalOrSynthetic<CulturalFramingPayload>('cultural_framing', {
      framings: [],
    }),
    crisisResources: optionalOrSynthetic<CrisisResourcesPayload>('crisis_resources', {
      resources: [],
      holdingMessage: '',
      todoPhase2Expansion: '',
    }),
    scenarios: optionalOrSynthetic<ScenariosPayload>('scenarios', {
      scenarios: [],
      notes: '',
    }),
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
    // SCRUM (PR 6) — skip integrity for synthetic empty payloads created
    // when an optional library was missing from the DB (version='absent').
    if (row.version === 'absent') continue;
    const expected = canonicalHash(row.payload);
    if (expected !== row.hash) {
      throw new LibraryResolverError(
        `hash mismatch for ${name}: stored=${row.hash.slice(0, 12)}... computed=${expected.slice(0, 12)}...`,
      );
    }
  }
}

/**
 * Phase 12 R10 — coupling: the QC voice-consistency check memoizes a
 * centroid of voice_rules positiveExamples. When a new voice_rules
 * version is published, that centroid was stale. With quality-check
 * removed (SCRUM-43), there's no longer a voice-centroid cache to
 * invalidate; clearing the library cache alone is sufficient.
 */
export function invalidateLibraryCache(): void {
  cache = undefined;
}

/** Test/teardown only. */
export function resetResolverForTests(): void {
  cache = undefined;
}

/** Re-export for callers that want to filter by name+version explicitly. */
export { libraryVersions, and };

/**
 * Standalone fetcher for the `daily_prompts` library — not part of the
 * Process #9 pinned bundle (daily prompts run on the cron scheduler, not
 * inside a coaching turn) so we don't include them in
 * `getActiveLibraryVersions`. Caller-managed cache; recommended TTL is the
 * same 60s the resolver uses, but daily prompts are tolerant of staler
 * reads — the cron tick is far less frequent than a coaching turn.
 */
export async function getActiveDailyPrompts(
  db: Database,
): Promise<{ version: string; hash: string; payload: DailyPromptsPayload }> {
  const rows = await db
    .select({
      version: libraryVersions.version,
      hash: libraryVersions.hash,
      payload: libraryVersions.payload,
    })
    .from(libraryVersions)
    .where(and(eq(libraryVersions.libraryName, 'daily_prompts'), eq(libraryVersions.active, true)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new LibraryResolverError(
      'no active version for library daily_prompts — run seed-libraries',
    );
  }
  return { version: row.version, hash: row.hash, payload: row.payload as DailyPromptsPayload };
}
