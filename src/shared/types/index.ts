// Domain types shared across modules. See plan §1.7.
//
// Branded IDs prevent accidentally passing a UserId where a SessionId is
// expected. They are zero-cost at runtime — just a TS type assertion.

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type UserId = Brand<string, 'UserId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type TurnId = Brand<string, 'TurnId'>;
export type CorrelationId = Brand<string, 'CorrelationId'>;
export type SponsorId = Brand<string, 'SponsorId'>;
export type CohortId = Brand<string, 'CohortId'>;
export type AccessCodeValue = Brand<string, 'AccessCodeValue'>;

/** SHA-256 hash of an E.164 phone, used as the user-resolution key everywhere. */
export type PhoneHash = Brand<string, 'PhoneHash'>;

/** Phone number in E.164 format. Plaintext form — never log or send to LLM providers. */
export type PhoneE164 = Brand<string, 'PhoneE164'>;

/** Unsafe-to-log values must traverse helpers that strip them before tracing. */
export type Plaintext<T extends string> = Brand<T, 'Plaintext'>;

export const asUserId = (s: string): UserId => s as UserId;
export const asSessionId = (s: string): SessionId => s as SessionId;
export const asTurnId = (s: string): TurnId => s as TurnId;
export const asCorrelationId = (s: string): CorrelationId => s as CorrelationId;
export const asSponsorId = (s: string): SponsorId => s as SponsorId;
export const asCohortId = (s: string): CohortId => s as CohortId;
export const asPhoneHash = (s: string): PhoneHash => s as PhoneHash;
export const asPhoneE164 = (s: string): PhoneE164 => s as PhoneE164;

// ---------------------------------------------------------------------------
// PRD §7 — twelve practices, four levels
// ---------------------------------------------------------------------------

export const PRACTICE_TAGS = [
  'integrity',
  'purpose',
  'accountability',
  'dignity',
  'empathy',
  'inclusion',
  'assets',
  'innovation',
  'prosperity',
  'humility',
  'democracy',
  'peace',
] as const;
export type PracticeTag = (typeof PRACTICE_TAGS)[number];
export const isPracticeTag = (v: string): v is PracticeTag =>
  (PRACTICE_TAGS as readonly string[]).includes(v);

export const LEVEL_TAGS = ['self', 'team', 'organization', 'community'] as const;
export type LevelTag = (typeof LEVEL_TAGS)[number];
export const isLevelTag = (v: string): v is LevelTag =>
  (LEVEL_TAGS as readonly string[]).includes(v);

// ---------------------------------------------------------------------------
// Process #9 — response modes
// ---------------------------------------------------------------------------

export const RESPONSE_MODES = [
  'FullCoachingResponse',
  'ProfileUpdateAcknowledgment',
  'ClarifyingQuestion',
  'MetaResponse',
  'ScenarioRolePlay',
] as const;
export type ResponseMode = (typeof RESPONSE_MODES)[number];

// ---------------------------------------------------------------------------
// Process #2 Step 3 — intent classification (8 classes)
// ---------------------------------------------------------------------------

export const INTENTS = [
  'Coaching',
  'ScenarioRequest',
  'ProfileUpdate',
  'MetaQuestion',
  'Greeting',
  'Affirmation',
  'ClarificationResponse',
  'OutOfScope',
] as const;
export type Intent = (typeof INTENTS)[number];

// ---------------------------------------------------------------------------
// Process-wide failure semantics
// ---------------------------------------------------------------------------

/** When a fail-open path takes a degraded route, mark the dimension that degraded. */
export interface DegradationFlags {
  memoryTruncated: boolean;
  sessionTruncated: boolean;
  culturalFramingDropped: boolean;
  fallbackModelUsed: boolean;
  contextFetchPartial: boolean;
}

export const noDegradation = (): DegradationFlags => ({
  memoryTruncated: false,
  sessionTruncated: false,
  culturalFramingDropped: false,
  fallbackModelUsed: false,
  contextFetchPartial: false,
});

/** Severity tier for incidents (Process #18). P0 pages, P1 alerts, P2 logs only. */
export type IncidentSeverity = 'P0' | 'P1' | 'P2';

/**
 * Library version snapshot the rest of the system pins against. See Process #9 Step 2.
 * Versioned together so a single turn cannot mix Voice Rules v3 with Cultural Framing v1.
 */
export interface LibraryVersionSet {
  promptTemplates: { version: string; hash: string };
  voiceRules: { version: string; hash: string };
  culturalFraming: { version: string; hash: string };
  resolvedAt: Date;
}
