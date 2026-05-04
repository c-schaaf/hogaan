import type { Database, SqlClient } from '../shared/db/client.js';
import { checkSuppression } from '../shared/redis/suppression.js';
import type { RedisBundle } from '../shared/redis/client.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { writeAuditEntry } from './audit.js';
import {
  AdvisoryLockTimeoutError,
  lookupAndRoute,
  LookupServiceUnavailableError,
} from './lookup.js';
import { normalizePhone, PhoneNormalizationError } from './normalize.js';
import { TokenInvalidError, TokenServiceUnavailableError, validateSessionToken } from './token.js';
import type { IdentityFailure, IdentityRequest, IdentityResult, IdentitySuccess } from './types.js';

interface Deps {
  config: AppConfig;
  sql: SqlClient;
  db: Database;
  redis: RedisBundle;
}

/**
 * Process #12 entry orchestrator. Implements the full BPMN — all 11 terminal
 * end events. The fail-closed contract for E11 (audit-log failure) is enforced
 * by writeAuditEntry() throwing AuditLogFailureError; this function does NOT
 * catch that — callers receive the throw as their hard-failure signal.
 *
 * Trigger source dispatches to one of two paths:
 *   - whatsapp / web_signup → phone path (steps 2–6)
 *   - web_session → token path (step 7)
 *
 * Both paths converge at step 8 (audit) → step 9 (output construction).
 */
export async function resolveIdentity(
  deps: Deps,
  request: IdentityRequest,
): Promise<IdentityResult> {
  const result =
    request.triggerSource === 'web_session'
      ? await resolveTokenPath(deps, request)
      : await resolvePhonePath(deps, request);

  const endEvent = result.kind === 'success' ? result.success.endEvent : result.failure.endEvent;

  // Step 8: fail-closed audit. Throws AuditLogFailureError on failure.
  await writeAuditEntry(deps.db, {
    requestId: request.requestId,
    triggerSource: request.triggerSource,
    endEvent,
    ...(result.kind === 'success' ? { userId: result.success.userId } : {}),
    ...(result.phoneHash !== undefined ? { phoneHash: result.phoneHash } : {}),
    ...('originatingIp' in request && request.originatingIp !== undefined
      ? { ipAddress: request.originatingIp }
      : {}),
    ...(result.kind === 'failure' && result.inputErrors !== undefined
      ? { inputErrors: result.inputErrors }
      : {}),
  });

  return result.kind === 'success' ? result.success : result.failure;
}

// ---------------------------------------------------------------------------
// Phone path — steps 2 through 6.
// ---------------------------------------------------------------------------

type InternalResult =
  | { kind: 'success'; success: IdentitySuccess; phoneHash?: string }
  | {
      kind: 'failure';
      failure: IdentityFailure;
      phoneHash?: string;
      inputErrors?: Record<string, unknown>;
    };

async function resolvePhonePath(
  deps: Deps,
  request: Extract<IdentityRequest, { triggerSource: 'whatsapp' | 'web_signup' }>,
): Promise<InternalResult> {
  // Step 2: phone normalization.
  let normalized;
  try {
    normalized = normalizePhone(request.phoneNumber);
  } catch (err) {
    if (err instanceof PhoneNormalizationError) {
      return {
        kind: 'failure',
        failure: { endEvent: 'E7_MalformedPhoneNumber', message: err.message },
        inputErrors: { reason: 'phone_normalization', detail: err.message },
      };
    }
    throw err;
  }

  // Step 3: suppression + block check (fail-closed).
  let suppressionStatus;
  try {
    suppressionStatus = await checkSuppression(deps.redis, normalized.hash);
  } catch (err) {
    return {
      kind: 'failure',
      failure: {
        endEvent: 'E10_IdentityServiceUnavailable',
        message: 'suppression check unavailable',
      },
      phoneHash: normalized.hash,
      inputErrors: { reason: 'redis_suppression_unavailable', detail: (err as Error).message },
    };
  }

  if (suppressionStatus === 'blocked') {
    return {
      kind: 'failure',
      failure: { endEvent: 'E6_BlockedUser', message: 'user is blocked' },
      phoneHash: normalized.hash,
    };
  }
  if (suppressionStatus === 'suppressed') {
    return {
      kind: 'failure',
      failure: { endEvent: 'E5_SuppressedUser', message: 'user has opted out' },
      phoneHash: normalized.hash,
    };
  }

  // Steps 4–6: lookup + lock + route + (insert if new).
  let route;
  try {
    route = await lookupAndRoute(
      deps.config,
      deps.sql,
      deps.db,
      normalized.hash,
      normalized.e164,
      request.triggerSource,
    );
  } catch (err) {
    if (err instanceof AdvisoryLockTimeoutError) {
      return {
        kind: 'failure',
        failure: {
          endEvent: 'E8_ConcurrentRequestRejected',
          message: 'another request is in flight; retry with backoff',
        },
        phoneHash: normalized.hash,
      };
    }
    if (err instanceof LookupServiceUnavailableError) {
      return {
        kind: 'failure',
        failure: {
          endEvent: 'E10_IdentityServiceUnavailable',
          message: 'identity lookup failed',
        },
        phoneHash: normalized.hash,
        inputErrors: { reason: 'lookup_failed', detail: err.message },
      };
    }
    throw err;
  }

  // Map RouteDecision → IdentitySuccess / E4 IdentityFailure.
  switch (route.kind) {
    case 'existing_onboarded':
      return {
        kind: 'success',
        success: {
          endEvent: 'E1_ExistingUserAuthenticated',
          userId: route.userId,
          status: 'onboarded',
          isNew: false,
          isResumed: false,
          lastCompletedStep: route.lastCompletedStep,
        },
        phoneHash: normalized.hash,
      };
    case 'new_user':
      return {
        kind: 'success',
        success: {
          endEvent: 'E2_NewUserProvisioned',
          userId: route.userId,
          status: 'provisional',
          isNew: true,
          isResumed: false,
          lastCompletedStep: 0,
        },
        phoneHash: normalized.hash,
      };
    case 'resume_onboarding':
      return {
        kind: 'success',
        success: {
          endEvent: 'E3_ResumeOnboardingDetected',
          userId: route.userId,
          status: route.status,
          isNew: false,
          isResumed: true,
          lastCompletedStep: route.lastCompletedStep,
        },
        phoneHash: normalized.hash,
      };
    case 'duplicate_signup':
      return {
        kind: 'failure',
        failure: {
          endEvent: 'E4_DuplicateSignupDetected',
          message: 'phone is already onboarded; signup not required',
          detail: { userId: route.userId },
        },
        phoneHash: normalized.hash,
      };
  }
}

// ---------------------------------------------------------------------------
// Token path — step 7.
// ---------------------------------------------------------------------------

async function resolveTokenPath(
  deps: Deps,
  request: Extract<IdentityRequest, { triggerSource: 'web_session' }>,
): Promise<InternalResult> {
  let validated;
  try {
    validated = await validateSessionToken(deps.config, deps.redis, request.sessionToken);
  } catch (err) {
    if (err instanceof TokenInvalidError) {
      return {
        kind: 'failure',
        failure: { endEvent: 'E9_WebSessionInvalid', message: err.message },
        inputErrors: { reason: 'token_invalid', detail: err.message },
      };
    }
    if (err instanceof TokenServiceUnavailableError) {
      return {
        kind: 'failure',
        failure: {
          endEvent: 'E10_IdentityServiceUnavailable',
          message: 'token service unavailable',
        },
        inputErrors: { reason: 'token_service_unavailable', detail: err.message },
      };
    }
    throw err;
  }

  // Token path treats the token as authoritative for identity (Phase 2B plan
  // open question §40). Status freshness is not re-checked from DB — Phase
  // 2 assumption.
  return {
    kind: 'success',
    success: {
      endEvent: 'E1_ExistingUserAuthenticated',
      userId: validated.userId,
      status: 'onboarded',
      isNew: false,
      isResumed: false,
      lastCompletedStep: 0,
    },
  };
}
