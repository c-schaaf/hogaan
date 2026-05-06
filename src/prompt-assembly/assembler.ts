import {
  getActiveLibraryVersions,
  LibraryResolverError,
  toVersionSet,
  type ResolvedLibraries,
} from '../libraries/index.js';
import type { Database } from '../shared/db/client.js';
import { reportIncident } from '../shared/observability/incidents.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { noDegradation, type LibraryVersionSet, type ResponseMode } from '../shared/types/index.js';
import {
  buildMemoryBlock,
  buildSessionContext,
  buildUserMessageBlock,
  buildUserProfileBlock,
} from './blocks.js';
import { computeDeterminismHash } from './determinism-hash.js';
import {
  buildLevelFraming,
  buildPracticeFraming,
  buildVoiceRules,
  selectCulturalFraming,
} from './framings.js';
import { writePromptLog } from './log.js';
import { selectSystemTemplate } from './template.js';
import { enforceTokenBudget } from './token-budget.js';
import {
  PromptAssemblyError,
  type InputPayload,
  type OutputBundle,
  type PromptUnderConstruction,
} from './types.js';
import { validateInputPayload } from './validate.js';

/**
 * Process #9 §15 + orchestrator. Walks Steps 1–13 inline, kicks off the
 * async §14 log write, returns the OutputBundle with the resolved
 * terminal end event.
 *
 * Returns OutputBundle for every reachable end event (success + soft
 * failures). Throws PromptAssemblyError for E5–E9 (caller maps to the
 * appropriate dispatch outcome — Process #2 §8 wraps these into a fallback
 * templated response). E10 is not thrown — it's reflected on the bundle's
 * logWriteFailed flag.
 *
 * `awaitLogWrite` is a test-only knob; default false (Phase 7 hot-path
 * fires-and-forgets).
 */
export interface AssembleOptions {
  /** Block on the prompt-log write before returning. Tests use true. */
  awaitLogWrite?: boolean;
}

export async function assemblePrompt(
  config: AppConfig,
  db: Database,
  payload: InputPayload,
  options: AssembleOptions = {},
): Promise<OutputBundle> {
  // Step 1: validate (throws PromptAssemblyError(E5) on failure)
  const validated = validateInputPayload(payload);

  // Step 2: resolve libraries + tag validation
  let libs: ResolvedLibraries;
  try {
    libs = await getActiveLibraryVersions(db);
  } catch (err) {
    if (err instanceof LibraryResolverError) {
      throw new PromptAssemblyError(err.message, 'E6_LibraryUnavailable');
    }
    throw new PromptAssemblyError(
      `library resolver failed: ${(err as Error).message}`,
      'E6_LibraryUnavailable',
    );
  }

  // Step 3: system template selection (throws E8)
  const template = selectSystemTemplate(libs.promptTemplates.payload, validated.responseMode);

  // Steps 4–5: practice + level framing (throw E7 on bad tag)
  const tagsRequired =
    validated.responseMode === 'FullCoachingResponse' ||
    validated.responseMode === 'ProfileUpdateAcknowledgment' ||
    validated.responseMode === 'ScenarioRolePlay';

  const practiceFramingText =
    tagsRequired && validated.practiceTag !== undefined
      ? buildPracticeFraming(libs.promptTemplates.payload, validated.practiceTag)
      : '';
  const levelFramingText =
    tagsRequired && validated.levelTag !== undefined
      ? buildLevelFraming(libs.promptTemplates.payload, validated.levelTag)
      : '';

  // Step 6: voice rules
  const voiceRulesText = buildVoiceRules(libs.voiceRules.payload);

  // Step 7: cultural framing (deterministic affinity-map for v1)
  const cultural = selectCulturalFraming(
    libs.culturalFraming.payload,
    validated.responseMode,
    validated.practiceTag,
  );

  // Steps 8–11: dynamic blocks
  const memoryBlockText = buildMemoryBlock(validated.retrievedMemories);
  const sessionContextText = buildSessionContext(validated.sessionTurns);
  const userProfileBlockText = buildUserProfileBlock(validated.userProfile);
  const userMessageText = buildUserMessageBlock(validated.userMessage);

  const initial: PromptUnderConstruction = {
    systemTemplateText: template.systemText,
    practiceFramingText,
    levelFramingText,
    voiceRulesText,
    culturalFramingText: cultural?.text ?? null,
    culturalFramingConcept: cultural?.concept ?? null,
    memoryBlockText,
    sessionContextText,
    userProfileBlockText,
    userMessageText,
  };

  // Step 12: token budget
  const budgetResult = enforceTokenBudget(initial, noDegradation());
  const finalPrompt = budgetResult.prompt;

  // Step 13: determinism hash (over STRUCTURAL inputs only — independent of
  // dynamic memory/session/user-message content)
  const versionSet: LibraryVersionSet = toVersionSet(libs);
  const determinismHash = computeDeterminismHash({
    responseMode: validated.responseMode,
    systemTemplateId: template.id,
    practiceTag: validated.practiceTag ?? null,
    levelTag: validated.levelTag ?? null,
    secondaryPracticeTag: payload.secondaryPracticeTag ?? null,
    secondaryLevelTag: payload.secondaryLevelTag ?? null,
    taggerConfidence: payload.taggerConfidence ?? null,
    culturalFramingConcept: finalPrompt.culturalFramingConcept,
    libraryVersions: versionSet,
  });

  // Step 15: assemble final text in canonical block order
  const assembledPrompt = canonicalAssemble(finalPrompt);

  // Map to terminal end event (E1–E4 / E9 / E10)
  if (budgetResult.oversize) {
    throw new PromptAssemblyError(
      `prompt over budget after all degradation strategies (${budgetResult.tokenCount} tokens)`,
      'E9_PromptOversize',
    );
  }
  const terminal = pickTerminalMode(validated.responseMode, budgetResult.flags);

  const bundleBase: OutputBundle = {
    endEvent: terminal,
    responseMode: validated.responseMode,
    assembledPrompt,
    determinismHash,
    tokenCount: budgetResult.tokenCount,
    degradationFlags: budgetResult.flags,
    libraryVersions: versionSet,
    oversize: false,
    logWriteFailed: false,
    practiceTag: validated.practiceTag ?? null,
    levelTag: validated.levelTag ?? null,
    assembledAt: new Date(),
  };

  // Step 14: async log write (fail-open). E10 reflected on bundle, never thrown.
  const logPromise = writePromptLog(config, db, validated, bundleBase);
  if (options.awaitLogWrite === true) {
    const logResult = await logPromise;
    if (!logResult.success) {
      return { ...bundleBase, endEvent: 'E10_PromptLogWriteFailed', logWriteFailed: true };
    }
  } else {
    // Background fire-and-forget. Surface failures via reportIncident inside writePromptLog.
    void logPromise.then((res) => {
      if (!res.success) {
        reportIncident('P2', 'prompt_logs background write failed', {
          source: 'Process_9.Step_14_PromptLog',
          extra: { determinismHash: bundleBase.determinismHash },
        });
      }
    });
  }

  return bundleBase;
}

function pickTerminalMode(
  mode: ResponseMode,
  flags: ReturnType<typeof noDegradation>,
): OutputBundle['endEvent'] {
  if (mode === 'ClarifyingQuestion') {
    return 'E3_PromptAssembledClarifyMode';
  }
  if (mode === 'MetaResponse') {
    return 'E4_PromptAssembledMetaMode';
  }
  // FullCoachingResponse, ProfileUpdateAcknowledgment, ScenarioRolePlay all
  // share the Normal/Degraded distinction.
  const degraded = flags.memoryTruncated || flags.sessionTruncated || flags.culturalFramingDropped;
  return degraded ? 'E2_PromptAssembledWithDegradation' : 'E1_PromptAssembledNormal';
}

/**
 * Canonical block order — same every assembly so determinism + diff'ing both
 * have stable axes.
 */
function canonicalAssemble(p: PromptUnderConstruction): string {
  const parts: string[] = [p.systemTemplateText];
  if (p.practiceFramingText.length > 0) {
    parts.push(p.practiceFramingText);
  }
  if (p.levelFramingText.length > 0) {
    parts.push(p.levelFramingText);
  }
  parts.push(p.voiceRulesText);
  if (p.culturalFramingText !== null && p.culturalFramingText.length > 0) {
    parts.push(p.culturalFramingText);
  }
  parts.push(p.memoryBlockText);
  parts.push(p.sessionContextText);
  parts.push(p.userProfileBlockText);
  parts.push(p.userMessageText);
  return parts.join('\n\n');
}
