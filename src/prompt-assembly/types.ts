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
 * Per-section text contributions to the assembled prompt. Each is a separate
 * named region so Step 12 can degrade specific blocks (memory, session,
 * cultural framing) without disturbing the rest.
 */
export interface PromptUnderConstruction {
  systemTemplateText: string;
  practiceFramingText: string;
  levelFramingText: string;
  voiceRulesText: string;
  /** Null when not applicable per Step 7 DMN, OR when degraded out by Step 12. */
  culturalFramingText: string | null;
  /** Sourced concept name (e.g., "Sharaf") for the chosen framing — preserved for trace. */
  culturalFramingConcept: string | null;
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
  tokenCount: number;
  degradationFlags: DegradationFlags;
  libraryVersions: LibraryVersionSet;
  /** Step 12 might have degraded (or refused). When endEvent==E9, prompt is unsafe to send. */
  oversize: boolean;
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
