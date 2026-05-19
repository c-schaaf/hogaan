import type { LevelTag, PracticeTag, ResponseMode } from '../shared/types/index.js';

/**
 * Payload schemas for each of the five libraries stored in `library_versions.payload`.
 * Process #9 §2 resolves all five together so a single turn pins one consistent
 * snapshot.
 *
 * **Hamse-owned (CLAUDE.md hard rule #3)**: voice_rules and cultural_framing
 * content. Engineering can change the schema (TS types). Only Hamse can
 * change the content under `payload`. Every payload change is a new version.
 */

// ===========================================================================
// 1. prompt_templates
// ===========================================================================

export interface PromptTemplate {
  /** Stable id used by Process #9 §3 system-template selection. */
  id:
    | 'coaching_main_v3'
    | 'profile_ack_v1'
    | 'clarify_v1'
    | 'meta_v1'
    | 'scenario_rolePlay_v1'
    | 'coaching_v3_leadership';
  responseMode: ResponseMode;
  /** Approximate token count of the system text — used for budget planning. */
  tokenBudget: number;
  systemText: string;
}

export interface PracticeFramingBlock {
  practice: PracticeTag;
  /** Belongs to one of: Self / Team / Organization / Community per PRD §7. */
  defaultLevel: LevelTag;
  shortDescription: string;
  /** Coaching questions the LLM may draw on. */
  coachingQuestions: string[];
  /** Reframings — how to translate user concerns through this practice. */
  reframings: string[];
}

export interface LevelFramingBlock {
  level: LevelTag;
  shortDescription: string;
  /** "leading the self / team / org / community" cues. */
  cues: string[];
}

export interface PromptTemplatesPayload {
  templates: PromptTemplate[];
  practiceFraming: PracticeFramingBlock[];
  levelFraming: LevelFramingBlock[];
  /** Free-form notes for engineering + content reviewers. */
  notes?: string;
}

// ===========================================================================
// 2. voice_rules
// ===========================================================================

export interface VoiceRule {
  id: string;
  title: string;
  description: string;
  /** When the rule applies. Free-form guidance for the LLM. */
  whenToApply: string;
  /** Concrete phrasings that exemplify the rule. */
  positiveExamples: string[];
  /** Phrasings that violate the rule — used by Process #10 Check 5. */
  negativeExamples: string[];
}

export interface VoiceRulesPayload {
  rules: VoiceRule[];
  /** Catalog of phrases that flag hero / savior / victim language for Check 5. */
  heroPhraseFlags: string[];
  /** Patterns that indicate the "useful to society" anchor was applied (Check 6). */
  usefulToSocietyPatterns: string[];
}

// ===========================================================================
// 3. cultural_framing
// ===========================================================================

export interface CulturalFraming {
  /** Concept name in Somali. */
  concept: string;
  /** Short English gloss — the LLM should provide this on first use per session. */
  gloss: string;
  shortDescription: string;
  /** Trigger conditions (mapped to the multi-input DMN at Process #9 §7). */
  applicableWhen: string[];
  /** Example phrasings the LLM may draw inspiration from. NOT verbatim quotes. */
  examplePhrasings: string[];
  /** Phase 12 R6 — practices this framing has affinity for. Used by
   *  selectCulturalFraming to find the right framing for a practice tag.
   *  Optional for backwards compatibility; v1 library populates these in
   *  R7+R8+R9. When missing, the legacy PRACTICE_TO_FRAMING fallback applies. */
  practicesMapped?: PracticeTag[];
}

export interface CulturalFramingPayload {
  framings: CulturalFraming[];
}

// ===========================================================================
// 4. crisis_resources
// ===========================================================================

export interface CrisisResource {
  name: string;
  region: 'somalia' | 'global';
  channels: { kind: 'phone' | 'web' | 'sms'; value: string; note?: string }[];
  /** Who should be routed here — short, plain English. */
  whenToRoute: string;
}

export interface CrisisResourcesPayload {
  resources: CrisisResource[];
  /** Templated holding response sent before the resource list. Brand-aligned. */
  holdingMessage: string;
  /**
   * Hardcoded v1 only ships Tabaha + Befrienders Worldwide per user decision.
   * Phase 2 expansion (PRD §10 R3) adds geo-specific resources for Hargeisa,
   * diaspora regions, etc.
   */
  todoPhase2Expansion: string;
}

// ===========================================================================
// 5. scenarios
// ===========================================================================

export interface ScenarioStep {
  /** 1-indexed step number within the scenario. */
  step: number;
  /** What the coach (Hogaan) says to set up the step. */
  coachPrompt: string;
  /** Hint shown to the LLM about what user replies to expect. */
  expectedUserResponseShape: string;
  /** Coach's evaluation rubric for the user's reply. */
  evaluationCriteria: string[];
}

export interface Scenario {
  id: string;
  title: string;
  /** The single practice this scenario exercises. */
  practice: PracticeTag;
  level: LevelTag;
  /** Short pitch shown to the user when they consider the scenario. */
  pitch: string;
  /** Multi-turn script the LLM uses as the spine. */
  steps: ScenarioStep[];
  /** What "completed" looks like — emit on profile when the user reaches it. */
  completionCriteria: string;
}

export interface ScenariosPayload {
  scenarios: Scenario[];
  /**
   * Per user decision: independent library, retakes allowed, no prerequisites,
   * completions logged on profile but NOT fed into coaching context.
   */
  notes: string;
}

// ===========================================================================
// 6. daily_prompts
// ===========================================================================

export interface DailyPrompt {
  id: string;
  /** Single practice this prompt anchors on. Drives rotation across the 12. */
  practice: PracticeTag;
  /** Daily prompt body text (max ~300 chars; some can be quotes, some questions). */
  body: string;
  /** Tags for trace + future analytics ('reflection' | 'question' | 'quote' | ...). */
  kind: 'reflection' | 'question' | 'quote';
}

export interface DailyPromptsPayload {
  prompts: DailyPrompt[];
  notes: string;
}

// ===========================================================================
// Discriminated union over all library payloads (for the resolver).
// ===========================================================================

export type LibraryPayload =
  | { libraryName: 'prompt_templates'; payload: PromptTemplatesPayload }
  | { libraryName: 'voice_rules'; payload: VoiceRulesPayload }
  | { libraryName: 'cultural_framing'; payload: CulturalFramingPayload }
  | { libraryName: 'crisis_resources'; payload: CrisisResourcesPayload }
  | { libraryName: 'scenarios'; payload: ScenariosPayload }
  | { libraryName: 'daily_prompts'; payload: DailyPromptsPayload };
