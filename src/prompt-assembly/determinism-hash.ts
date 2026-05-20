import { createHash } from 'node:crypto';
import type { LibraryVersionSet, ResponseMode } from '../shared/types/index.js';

/**
 * Determinism hash. SHA-256 over **structural** elements only:
 *
 *   - responseMode
 *   - systemTemplateId
 *   - active library versions (promptTemplates)
 *
 * Excluded (dynamic): userMessage, sessionTurns, retrievedMemories, profile.
 * Two turns with the same structural setup produce the same hash, even
 * though their actual prompt text differs because of dynamic content.
 *
 * Used by the voice-fidelity audit harness to find "every prompt
 * structurally identical to this one" and rerun them under a new library
 * version for regression detection.
 *
 * SCRUM (PR 5) — bumped to `'v3'` with the audit cleanup that trimmed the
 * structural input set. The tagger has been stubbed since the unified
 * prompt landed (see `validate.ts:7-15`), so `practiceTag` / `levelTag` /
 * `secondaryPracticeTag` / `secondaryLevelTag` / `taggerConfidence` were
 * always null on every live row and contributed nothing distinguishing.
 * Removing them makes the hash describe what actually varies. Pre-v3
 * hashes will never match post-v3 hashes by design — the audit harness
 * should treat the version bump as a cohort boundary.
 */
export const DETERMINISM_HASH_VERSION = 'v3';

export interface StructuralInputs {
  responseMode: ResponseMode;
  systemTemplateId: string;
  libraryVersions: LibraryVersionSet;
}

export function computeDeterminismHash(inputs: StructuralInputs): string {
  // Canonicalize: stable key order, ISO date, no trailing whitespace.
  const canonical = JSON.stringify({
    hashVersion: DETERMINISM_HASH_VERSION,
    responseMode: inputs.responseMode,
    systemTemplateId: inputs.systemTemplateId,
    libraryVersions: {
      promptTemplates: inputs.libraryVersions.promptTemplates,
    },
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
