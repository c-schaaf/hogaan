import type { UserId } from '../shared/types/index.js';
import type { IdentityEndEvent } from './end-events.js';

export type TriggerSource = 'whatsapp' | 'web_session' | 'web_signup';

export interface WhatsappRequest {
  triggerSource: 'whatsapp';
  phoneNumber: string;
  inboundMessageId: string;
  requestId: string;
}

export interface WebSignupRequest {
  triggerSource: 'web_signup';
  phoneNumber: string;
  originatingIp?: string;
  formSubmissionId: string;
  requestId: string;
}

export interface WebSessionRequest {
  triggerSource: 'web_session';
  sessionToken: string;
  originatingIp?: string;
  userAgent?: string;
  requestId: string;
}

export type IdentityRequest = WhatsappRequest | WebSignupRequest | WebSessionRequest;

/** Successful resolution carrying a userId. */
export interface IdentitySuccess {
  endEvent:
    | 'E1_ExistingUserAuthenticated'
    | 'E2_NewUserProvisioned'
    | 'E3_ResumeOnboardingDetected';
  userId: UserId;
  status: 'provisional' | 'onboarding_started' | 'onboarding_dormant' | 'onboarded';
  isNew: boolean;
  isResumed: boolean;
  /** lastCompletedStep from the user record — nonzero indicates onboarding is mid-flow. */
  lastCompletedStep: number;
}

export interface IdentityFailure {
  endEvent: Exclude<
    IdentityEndEvent,
    'E1_ExistingUserAuthenticated' | 'E2_NewUserProvisioned' | 'E3_ResumeOnboardingDetected'
  >;
  /** Sanitized error message — no PII. Safe to surface to the caller. */
  message: string;
  /** When applicable (E4, E10): supplemental data the caller may need. */
  detail?: Record<string, unknown>;
}

/**
 * Process #12 §9 output. **E11 (AuditLogFailure) is special**: per CLAUDE.md
 * hard rule #4, when audit-log write fails the caller does NOT receive any
 * authentication result. resolveIdentity() THROWS instead of returning E11 —
 * the throw is the contract.
 */
export type IdentityResult = IdentitySuccess | IdentityFailure;

/** Thrown only when the audit log write fails (E11). */
export class AuditLogFailureError extends Error {
  public readonly endEvent = 'E11_AuditLogFailure' as const;
  public readonly requestId: string;

  constructor(requestId: string, cause?: unknown) {
    super('audit_log_write_failed: caller MUST treat as hard failure');
    this.name = 'AuditLogFailureError';
    this.requestId = requestId;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}
