import type {
  CulturalFramingPayload,
  PromptTemplatesPayload,
  VoiceRulesPayload,
} from '../libraries/index.js';
import type { LevelTag, PracticeTag, ResponseMode } from '../shared/types/index.js';
import { PromptAssemblyError } from './types.js';

/**
 * Process #9 §4 — practice framing block. Lookup against the active
 * prompt_templates library. E7 if the requested practiceTag isn't in the
 * catalog.
 */
export function buildPracticeFraming(
  templates: PromptTemplatesPayload,
  practiceTag: PracticeTag,
): string {
  const block = templates.practiceFraming.find((p) => p.practice === practiceTag);
  if (block === undefined) {
    throw new PromptAssemblyError(
      `practice "${practiceTag}" not present in active prompt_templates library`,
      'E7_PracticeOrLevelTagInvalid',
    );
  }
  const lines: string[] = [
    `## Practice: ${practiceTag} (default level: ${block.defaultLevel})`,
    block.shortDescription,
    '',
    'Coaching questions to draw on:',
    ...block.coachingQuestions.map((q) => `- ${q}`),
    '',
    'Reframings:',
    ...block.reframings.map((r) => `- ${r}`),
  ];
  return lines.join('\n');
}

/**
 * Process #9 §5 — level framing block. Lookup against the active
 * prompt_templates library. E7 if the requested levelTag isn't in the
 * catalog.
 */
export function buildLevelFraming(templates: PromptTemplatesPayload, levelTag: LevelTag): string {
  const block = templates.levelFraming.find((l) => l.level === levelTag);
  if (block === undefined) {
    throw new PromptAssemblyError(
      `level "${levelTag}" not present in active prompt_templates library`,
      'E7_PracticeOrLevelTagInvalid',
    );
  }
  const lines: string[] = [
    `## Level: ${levelTag}`,
    block.shortDescription,
    '',
    'Cues:',
    ...block.cues.map((c) => `- ${c}`),
  ];
  return lines.join('\n');
}

/** Process #9 §6 — voice rules block. All rules render every time; the LLM picks which apply. */
export function buildVoiceRules(voiceRules: VoiceRulesPayload): string {
  const lines: string[] = ['## Voice Rules', ''];
  for (const r of voiceRules.rules) {
    lines.push(`### ${r.id} — ${r.title}`);
    lines.push(r.description);
    lines.push(`When to apply: ${r.whenToApply}`);
    if (r.positiveExamples.length > 0) {
      lines.push('Positive examples:');
      for (const e of r.positiveExamples) {
        lines.push(`  + ${e}`);
      }
    }
    if (r.negativeExamples.length > 0) {
      lines.push('Negative examples:');
      for (const e of r.negativeExamples) {
        lines.push(`  - ${e}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/**
 * Process #9 §7 — cultural framing selection. Multi-input DMN per the BPMN;
 * Phase 4 ships a deterministic affinity-map version (one Somali concept per
 * practice). Phase 9 plan §4C.3 widens this to include isDiaspora + message-
 * content signals.
 *
 * Modes that exclude framing: ClarifyingQuestion (focused single question;
 * one term would dilute it), MetaResponse (out-of-scope chat about the bot),
 * ProfileUpdateAcknowledgment (terse "I heard you" — no framing).
 *
 * Voice Rule r7: at most one Somali term per response. We return at most one
 * concept.
 */
const PRACTICE_TO_FRAMING: Record<PracticeTag, string> = {
  integrity: 'Sharaf',
  purpose: 'Wadanjirka',
  accountability: 'Maslaxad',
  dignity: 'Naxariis',
  empathy: 'Sahan',
  inclusion: 'Tol',
  assets: 'Refugee resilience',
  innovation: 'Pastoral leadership',
  prosperity: 'Aragti dheer',
  humility: 'Poet as truth-teller',
  democracy: 'Geed daad',
  peace: 'Maslaxad',
};

export function selectCulturalFraming(
  framingLib: CulturalFramingPayload,
  responseMode: ResponseMode,
  practiceTag: PracticeTag | undefined,
): { text: string; concept: string } | null {
  const excluded =
    responseMode === 'ClarifyingQuestion' ||
    responseMode === 'MetaResponse' ||
    responseMode === 'ProfileUpdateAcknowledgment';
  if (excluded) {
    return null;
  }
  if (practiceTag === undefined) {
    return null;
  }
  const conceptName = PRACTICE_TO_FRAMING[practiceTag];
  const concept = framingLib.framings.find((f) => f.concept === conceptName);
  if (concept === undefined) {
    return null;
  }

  const lines: string[] = [
    `## Cultural framing: ${concept.concept}`,
    `Gloss: ${concept.gloss}`,
    concept.shortDescription,
    '',
    'Applicable when:',
    ...concept.applicableWhen.map((a) => `- ${a}`),
    '',
    'Example phrasings (inspiration only — never quote verbatim):',
    ...concept.examplePhrasings.map((e) => `  ~ ${e}`),
  ];
  return { text: lines.join('\n'), concept: concept.concept };
}

/** Test seam — exposes the affinity map for audits without re-deriving it. */
export const _practiceToFraming = PRACTICE_TO_FRAMING;
