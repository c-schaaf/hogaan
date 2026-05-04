import { createHash } from 'node:crypto';
import type { LibraryVersionSet, ResponseMode } from '../shared/types/index.js';

/**
 * Process #9 §13 — determinism hash. SHA-256 over **structural** elements
 * only:
 *
 *   - responseMode
 *   - systemTemplateId
 *   - practiceTag, levelTag
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
 */
export interface StructuralInputs {
  responseMode: ResponseMode;
  systemTemplateId: string;
  practiceTag: string | null;
  levelTag: string | null;
  culturalFramingConcept: string | null;
  libraryVersions: LibraryVersionSet;
}

export function computeDeterminismHash(inputs: StructuralInputs): string {
  // Canonicalize: stable key order, ISO date, no trailing whitespace.
  const canonical = JSON.stringify({
    responseMode: inputs.responseMode,
    systemTemplateId: inputs.systemTemplateId,
    practiceTag: inputs.practiceTag,
    levelTag: inputs.levelTag,
    culturalFramingConcept: inputs.culturalFramingConcept,
    libraryVersions: {
      promptTemplates: inputs.libraryVersions.promptTemplates,
      voiceRules: inputs.libraryVersions.voiceRules,
      culturalFraming: inputs.libraryVersions.culturalFraming,
    },
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
