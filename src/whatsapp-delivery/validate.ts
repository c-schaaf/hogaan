import { WhatsAppRequestValidationError, type OutboundRequest } from './types.js';

const MAX_BODY_LEN = 1600; // WhatsApp single-message body cap.
const MAX_PARAMS = 10;

/**
 * Process #11 Step 1 — schema validation. Raises WhatsAppRequestValidationError
 * (orchestrator maps to E6 MalformedRequest). Cheap, synchronous, runs before
 * any Redis or DB call.
 */
export function validateOutboundRequest(req: unknown): OutboundRequest {
  if (req === null || typeof req !== 'object') {
    throw new WhatsAppRequestValidationError('request must be an object', 'request');
  }
  const r = req as Record<string, unknown>;

  if (typeof r['correlationId'] !== 'string' || r['correlationId'].length === 0) {
    throw new WhatsAppRequestValidationError('correlationId is required', 'correlationId');
  }
  if (typeof r['callerProcessId'] !== 'string' || r['callerProcessId'].length === 0) {
    throw new WhatsAppRequestValidationError('callerProcessId is required', 'callerProcessId');
  }
  if (typeof r['phoneE164'] !== 'string' || !/^\+[1-9]\d{1,14}$/.test(r['phoneE164'])) {
    throw new WhatsAppRequestValidationError('phoneE164 must be E.164', 'phoneE164');
  }
  if (r['messageType'] !== 'FreeForm' && r['messageType'] !== 'Template') {
    throw new WhatsAppRequestValidationError(
      'messageType must be FreeForm or Template',
      'messageType',
    );
  }
  if (r['priority'] !== 'Normal' && r['priority'] !== 'High' && r['priority'] !== 'Critical') {
    throw new WhatsAppRequestValidationError(
      'priority must be Normal | High | Critical',
      'priority',
    );
  }

  if (r['messageType'] === 'FreeForm') {
    if (typeof r['body'] !== 'string' || r['body'].length === 0) {
      throw new WhatsAppRequestValidationError('FreeForm requires non-empty body', 'body');
    }
    if (r['body'].length > MAX_BODY_LEN) {
      throw new WhatsAppRequestValidationError(`body exceeds ${MAX_BODY_LEN} chars`, 'body');
    }
  } else {
    if (typeof r['templateName'] !== 'string' || r['templateName'].length === 0) {
      throw new WhatsAppRequestValidationError('Template requires templateName', 'templateName');
    }
    if (r['templateParams'] !== undefined) {
      if (!Array.isArray(r['templateParams']) || r['templateParams'].length > MAX_PARAMS) {
        throw new WhatsAppRequestValidationError(
          `templateParams must be an array of ≤${MAX_PARAMS} strings`,
          'templateParams',
        );
      }
      for (const p of r['templateParams']) {
        if (typeof p !== 'string') {
          throw new WhatsAppRequestValidationError(
            'templateParams entries must be strings',
            'templateParams',
          );
        }
      }
    }
  }

  if (r['userId'] !== undefined && typeof r['userId'] !== 'string') {
    throw new WhatsAppRequestValidationError('userId must be a string', 'userId');
  }

  return r as unknown as OutboundRequest;
}
