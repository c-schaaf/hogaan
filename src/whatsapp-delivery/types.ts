import type { CorrelationId, UserId } from '../shared/types/index.js';
import type { WhatsappEndEvent } from './end-events.js';

export type Priority = 'Normal' | 'High' | 'Critical';
export type MessageType = 'FreeForm' | 'Template';

/**
 * Process #11 input contract. Every upstream caller (Onboarding, Coaching,
 * Daily Prompt, Crisis Handoff) constructs one of these and hands it to
 * `sendOutbound()`.
 */
export interface OutboundRequest {
  /** Stable id supplied by the caller — drives idempotency. */
  correlationId: CorrelationId;
  /** Identifies which upstream process owns this dispatch. */
  callerProcessId: string;
  /** E.164. The orchestrator hashes this for suppression check. */
  phoneE164: string;
  /** Optional: when the upstream process resolved an internal user, we record it. */
  userId?: UserId;
  messageType: MessageType;
  priority: Priority;
  /** Free-form body (used when messageType=FreeForm). */
  body?: string;
  /** Template name (used when messageType=Template). Must exist in the active prompt_templates library. */
  templateName?: string;
  /** Ordered template substitution params. */
  templateParams?: string[];
}

/**
 * Output of `sendOutbound()`. Retains everything callers need to trace the
 * dispatch end-to-end and emit a TurnTrace if applicable.
 */
export interface OutboundResult {
  endEvent: WhatsappEndEvent;
  /** Provider id (Twilio Message SID) when the API accepted the message. */
  waMessageId?: string;
  /** When the underlying flow took a non-default branch (queued, retried), record it. */
  dispatchPath: 'direct' | 'after-retry' | 'queued' | 'duplicate' | 'failed';
  retryCount: number;
  queueLoops: number;
  /** Sanitized failure reason — safe for caller logs. No PII. */
  reason?: string;
}

/**
 * Inbound message events. Process #11 §12 reconciliation handles the status
 * variants; inbound user messages (the WhatsApp webhook the user texts to)
 * land here as `inbound`.
 */
export type InboundEvent =
  | {
      kind: 'inbound';
      /** E.164 of the sender. */
      fromE164: string;
      /** Twilio inbound message SID. */
      waMessageId: string;
      body: string;
      mediaUrls: string[];
      receivedAt: Date;
    }
  | {
      kind: 'status';
      /** Twilio outbound message SID — joins back to whatsapp_messages.wa_message_id. */
      waMessageId: string;
      status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'undelivered';
      /** Twilio provides an error code when status=failed/undelivered. */
      errorCode?: string;
      timestamp: Date;
    };

export class WhatsAppRequestValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
  ) {
    super(message);
    this.name = 'WhatsAppRequestValidationError';
  }
}
