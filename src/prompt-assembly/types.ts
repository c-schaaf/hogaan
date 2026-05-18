import type {
  DegradationFlags,
  LevelTag,
  LibraryVersionSet,
  PracticeTag,
  ResponseMode,
  SessionId,
  TurnId,
  UserId,
} from '../shared/types/index.js';
import type { PromptAssemblyEndEvent } from './end-events.js';

/**
 * Process #9 §1 input. Process #2 §8 fills this from the resolved context;
 * Process #1 §8 fills this for onboarding confirmation prompts.
 *
 * Tag fields are required for FullCoachingResponse / ProfileUpdateAcknowledgment
 * / ScenarioRolePlay. ClarifyingQuestion and MetaResponse don't need them.
 */
export interface InputPayload {
  userId?: UserId;
  sessionId?: SessionId;
  turnId?: TurnId;
  responseMode: ResponseMode;
  /** Required for modes that inject practice + level framing. */
  practiceTag?: PracticeTag;
  levelTag?: LevelTag;
  /** Phase 12 R24 — Phase 11 R17 tagger fields, threaded into the
   *  determinism hash. Optional for backwards compatibility; orchestrator
   *  passes them when available. */
  secondaryPracticeTag?: PracticeTag | null;
  secondaryLevelTag?: LevelTag | null;
  taggerConfidence?: number | null;
  userMessage: string;
  /** From the user record. Not all fields required; missing ones get omitted. */
  userProfile: {
    firstName?: string;
    role?: string;
    /**
     * Customer-feedback PR4 — leadership experience band: '<5' | '5-10' | '10+'.
     * When present, prompt assembly emits an Experience line and omits Role.
     */
    experienceBand?: string;
    location?: string;
    isDiaspora?: boolean;
    timezone?: string;
    goals?: string[];
    mappedPractices?: PracticeTag[];
  };
  /** Memories already retrieved by Process #2 §5a. Oldest-first. */
  retrievedMemories: { content: string; createdAt: Date }[];
  /** Recent turns from Process #2 §5c. Oldest-first. */
  sessionTurns: { userMessage: string; responseText: string | null }[];
}

/**
 * Per-section text contributions to the assembled prompt. Since SCRUM-47,
 * the v1 multi-block path (practice/level framings, voice rules, cultural
 * framing, directives) is gone — those static framings now live inside
 * `systemTemplateText`. Only dynamic per-user blocks are assembled
 * separately at runtime.
 */
export interface PromptUnderConstruction {
  systemTemplateText: string;
  memoryBlockText: string;
  sessionContextText: string;
  userProfileBlockText: string;
  userMessageText: string;
}

export interface OutputBundle {
  endEvent: PromptAssemblyEndEvent;
  responseMode: ResponseMode;
  /** Final assembled prompt text in canonical block order. */
  assembledPrompt: string;
  /** SHA-256 over structural elements only. Identical structural inputs → identical hash. */
  determinismHash: string;
  /**
   * Observational only — chars/3.5 estimate of the assembled prompt. Never
   * gates execution (the 4000-token budget was removed in SCRUM-55 once we
   * confirmed Haiku 4.5's 200k context dwarfs any realistic prompt). Kept on
   * the bundle so trace + prompt_logs + orchestrator debug surfaces still
   * have a token figure to log.
   */
  tokenCount: number;
  /**
   * SCRUM-55 — token-budget degradations (memory/session truncation, cultural
   * framing drop) are no longer set from prompt-assembly; this is always
   * `noDegradation()`. The field is preserved because `src/coaching/`
   * orchestrator reads `memoryTruncated` / `sessionTruncated` /
   * `culturalFramingDropped` into the trace + turns row, and because the
   * remaining two flags (`fallbackModelUsed`, `contextFetchPartial`) are
   * still meaningful for downstream stages.
   */
  degradationFlags: DegradationFlags;
  libraryVersions: LibraryVersionSet;
  /** True when the async prompt-log write failed (E10) — caller may retry the log. */
  logWriteFailed: boolean;
  practiceTag: PracticeTag | null;
  levelTag: LevelTag | null;
  /** Diagnostic. */
  assembledAt: Date;
}

/** Thrown by the orchestrator only on programming errors — terminal events return via OutputBundle. */
export class PromptAssemblyError extends Error {
  public readonly endEvent: PromptAssemblyEndEvent;
  constructor(message: string, endEvent: PromptAssemblyEndEvent) {
    super(message);
    this.name = 'PromptAssemblyError';
    this.endEvent = endEvent;
  }
}
