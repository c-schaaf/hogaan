import { createHash } from 'node:crypto';
import type { LibraryVersionSet, ResponseMode } from '../shared/types/index.js';

/**
 * Process #9 §13 — determinism hash. SHA-256 over **structural** elements
 * only:
 *
 *   - responseMode
 *   - systemTemplateId
 *   - practiceTag, levelTag
 *   - secondaryPracticeTag, secondaryLevelTag, taggerConfidence (R17/R24)
 *   - voiceRules version + hash
 *   - culturalFramingConcept (or null)
 *   - culturalFraming version + hash
 *   - promptTemplates version + hash
 *
 * Excluded (dynamic): userMessage, sessionTurns, retrievedMemories, profile.
 * Two turns with the same structural setup produce the same hash, even
 * though their actual prompt text differs because of dynamic content.
 *
 * Used by the Phase 7.15 voice-fidelity audit harness to find "every prompt
 * structurally identical to this one" and rerun them under a new library
 * version for regression detection.
 *
 * Hash version: any change to the tagger output schema (e.g. adding a new
 * tag dimension) MUST bump the hash version. Two turns from before vs.
 * after such a change should NOT produce the same hash even if their
 * surface fields look identical — they're tagged with different
 * machinery.
 */
export const DETERMINISM_HASH_VERSION = 'v2'; // Phase 12 R24 — added secondary + confidence

export interface StructuralInputs {
  responseMode: ResponseMode;
  systemTemplateId: string;
  practiceTag: string | null;
  levelTag: string | null;
  /** Phase 12 R24 — Phase 11 R17 tagger fields. */
  secondaryPracticeTag?: string | null;
  secondaryLevelTag?: string | null;
  /** Tagger confidence ∈ [0, 1]. Rounded to 2 decimals to keep similar
   *  confidences hashing the same (replay tolerance). */
  taggerConfidence?: number | null;
  culturalFramingConcept: string | null;
  libraryVersions: LibraryVersionSet;
}

export function computeDeterminismHash(inputs: StructuralInputs): string {
  // Canonicalize: stable key order, ISO date, no trailing whitespace.
  const canonical = JSON.stringify({
    hashVersion: DETERMINISM_HASH_VERSION,
    responseMode: inputs.responseMode,
    systemTemplateId: inputs.systemTemplateId,
    practiceTag: inputs.practiceTag,
    levelTag: inputs.levelTag,
    secondaryPracticeTag: inputs.secondaryPracticeTag ?? null,
    secondaryLevelTag: inputs.secondaryLevelTag ?? null,
    taggerConfidence:
      inputs.taggerConfidence === undefined || inputs.taggerConfidence === null
        ? null
        : Number(inputs.taggerConfidence.toFixed(2)),
    culturalFramingConcept: inputs.culturalFramingConcept,
    libraryVersions: {
      promptTemplates: inputs.libraryVersions.promptTemplates,
      voiceRules: inputs.libraryVersions.voiceRules,
      culturalFraming: inputs.libraryVersions.culturalFraming,
    },
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
