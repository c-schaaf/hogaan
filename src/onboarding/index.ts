export {
  ONBOARDING_END_EVENTS,
  isOnboardingComplete,
  type OnboardingEndEvent,
} from './end-events.js';
export {
  EXPERIENCE_BANDS,
  GOAL_OPTIONS,
  ROLE_OPTIONS,
  OnboardingError,
  type ExperienceBand,
  type GoalOption,
  type LastCompletedStep,
  type OnboardingInboundEvent,
  type OnboardingResult,
  type RoleOption,
} from './types.js';
export { handleOnboardingMessage } from './orchestrator.js';
export { dispatchOnboardingNudges, type NudgeRunResult } from './nudges.js';
export { isOptOutMessage, recordOptOut } from './opt-out.js';
export {
  parseConsent,
  parseExperienceBand,
  parseGoals,
  parseRole,
  parseLocation,
  goalsToPractices,
  type ConsentResult,
  type GoalParseResult,
  type LocationParseResult,
} from './parsers.js';
export { extractCodeCandidate, tryRedeemCode, type RedeemResult } from './code-redemption.js';
export { generateConfirmation } from './confirmation.js';
