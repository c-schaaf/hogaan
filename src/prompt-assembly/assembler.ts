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
import { writePromptLog } from './log.js';
import { selectSystemTemplate } from './template.js';
import {
  PromptAssemblyError,
  type InputPayload,
  type OutputBundle,
  type PromptUnderConstruction,
} from './types.js';
import { validateInputPayload } from './validate.js';

/**
 * Prompt assembly orchestrator.
 *
 * Returns OutputBundle for every reachable end event (success + soft
 * failures). Throws PromptAssemblyError for E5–E8 (caller maps to the
 * appropriate dispatch outcome). E10 is reflected on the bundle's
 * logWriteFailed flag, never thrown.
 *
 * Since SCRUM-47, the unified template is the only assembly path —
 * the v1 multi-block path (practice framing, level framing, voice rules,
 * cultural framing, directives) was removed along with its dormant tests.
 * Static framings now live inside `systemText` itself. The assembler
 * concatenates the system template with the dynamic per-user blocks
 * (memory, session, profile, message) and returns.
 *
 * `awaitLogWrite` is a test-only knob; default false (hot-path
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

  // Step 2: resolve libraries
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

  // Dynamic blocks
  const memoryBlockText = buildMemoryBlock(validated.retrievedMemories);
  // SCRUM — when the caller will pass prior turns via the LLM's messages[]
  // parameter, omit the session-context block from the system prompt so the
  // model doesn't see the same history twice. (The streaming chat path
  // does this; the legacy non-streaming path keeps the block as before.)
  const sessionContextText =
    validated.historyInMessages === true ? '' : buildSessionContext(validated.sessionTurns);
  const userProfileBlockText = buildUserProfileBlock(validated.userProfile);
  const userMessageText = buildUserMessageBlock(validated.userMessage);

  const finalPrompt: PromptUnderConstruction = {
    systemTemplateText: template.systemText,
    memoryBlockText,
    sessionContextText,
    userProfileBlockText,
    userMessageText,
  };

  // Determinism hash over STRUCTURAL inputs only — independent of dynamic
  // memory/session/user-message content. SCRUM (PR 5) — bumped to v3 with
  // the tagger fields removed since they have been null on every live
  // row since the tagger was stubbed.
  const versionSet: LibraryVersionSet = toVersionSet(libs);
  const determinismHash = computeDeterminismHash({
    responseMode: validated.responseMode,
    systemTemplateId: template.id,
    libraryVersions: versionSet,
  });

  // Assemble final text in canonical block order.
  const assembledPrompt = canonicalAssemble(finalPrompt);
  const terminal = pickTerminalMode(validated.responseMode);

  // tokenCount stays on the bundle for observability. Computed post-assembly
  // purely as a metric — never gates execution (SCRUM-55).
  const tokenCount = Math.ceil(assembledPrompt.length / 3.5);

  const bundleBase: OutputBundle = {
    endEvent: terminal,
    responseMode: validated.responseMode,
    assembledPrompt,
    determinismHash,
    tokenCount,
    degradationFlags: noDegradation(),
    libraryVersions: versionSet,
    logWriteFailed: false,
    practiceTag: validated.practiceTag ?? null,
    levelTag: validated.levelTag ?? null,
    assembledAt: new Date(),
  };

  // Async log write (fail-open). E10 reflected on bundle, never thrown.
  const logPromise = writePromptLog(config, db, validated, bundleBase);
  if (options.awaitLogWrite === true) {
    const logResult = await logPromise;
    if (!logResult.success) {
      return { ...bundleBase, endEvent: 'E10_PromptLogWriteFailed', logWriteFailed: true };
    }
  } else {
    void logPromise.then((res) => {
      if (!res.success) {
        reportIncident('P2', 'prompt_logs background write failed', {
          source: 'PromptAssembly.LogWrite',
          extra: { determinismHash: bundleBase.determinismHash },
        });
      }
    });
  }

  return bundleBase;
}

function pickTerminalMode(mode: ResponseMode): OutputBundle['endEvent'] {
  if (mode === 'ClarifyingQuestion') {
    return 'E3_PromptAssembledClarifyMode';
  }
  if (mode === 'MetaResponse') {
    return 'E4_PromptAssembledMetaMode';
  }
  return 'E1_PromptAssembledNormal';
}

/**
 * Canonical block order — same every assembly so determinism + diff'ing both
 * have stable axes. Empty blocks are filtered so the prompt doesn't gain
 * stray double-newline gaps when an opt-in section is suppressed
 * (e.g. `historyInMessages` skips the session-context block).
 */
function canonicalAssemble(p: PromptUnderConstruction): string {
  return [
    p.systemTemplateText,
    p.memoryBlockText,
    p.sessionContextText,
    p.userProfileBlockText,
    p.userMessageText,
  ]
    .filter((b) => b.length > 0)
    .join('\n\n');
}
