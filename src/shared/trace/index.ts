import { Axiom } from '@axiomhq/js';
import type { AppConfig } from '../secrets/config.js';
import type { DegradationFlags, LibraryVersionSet } from '../types/index.js';

/**
 * Per-turn trace record. Process #2 §12c emits exactly one of these per turn,
 * regardless of which terminal end event the turn reached. Plan §1.4 names
 * every field below as required.
 *
 * PII discipline: userIdHash, never plaintext phone or first name. Library
 * versions land here so a voice-fidelity audit can reproduce a flagged turn
 * by replaying against the same library snapshot.
 */
export interface TurnTrace {
  traceId: string;
  userIdHash: string;
  sessionId: string;
  turnId: string;
  /** Step where the turn finished — process number + step number for grep-ability. */
  terminalEvent: string;
  modelUsed: 'claude-haiku-4-5' | 'llama-3.3-70b' | 'safe-template' | 'none';
  fallbackPath: 'none' | 'fast-model' | 'safe-template' | 'service-unavailable';
  latencyMs: number;
  qaOutcome:
    | 'approved-first'
    | 'approved-regenerated'
    | 'crisis'
    | 'service-unavailable'
    /**
     * E8_ShipDegradedCandidate — the R-07 budget gate fired and only
     * soft_fails were present. The Haiku candidate was delivered to the
     * user with a quality flag instead of being replaced with the
     * fallback template. softFailedCheckIds in the QcResult lists which
     * graders disagreed.
     */
    | 'shipped-degraded'
    | 'skipped';
  /** Batch P Piece 4 — verdict from check_17 (LLM-judged practice grounding).
   *  Optional: undefined for non-coaching response modes (Greeting,
   *  Affirmation, Meta, ProfileUpdate) which never reach QC. */
  practiceGroundingVerdict?: 'grounded' | 'mentioned' | 'absent' | 'service_unavailable';
  // 2026-05-08 audit: levelFidelityVerdict (from check_16) removed alongside
  // check_13 (voice_consistency) — both graded rules absent from the primary
  // system prompt. Implementations preserved for potential future telemetry.
  degradationFlags: DegradationFlags;
  libraryVersions: LibraryVersionSet;
  determinismHash: string | null;
  retryCount: number;
  createdAt: string;
}

export interface TraceEmitter {
  emit(record: TurnTrace): void;
  flush(): Promise<void>;
}

const AXIOM_DATASET_FIELD_NAME = 'turns';

/**
 * Build the singleton trace emitter.
 *
 * In production with Axiom credentials: ingest via @axiomhq/js (which buffers
 * internally and flushes on a timer or buffer-full).
 *
 * Without Axiom credentials: log to stdout as JSON. Keeps dev + tests
 * inspectable; never throws.
 */
export function buildTraceEmitter(config: AppConfig): TraceEmitter {
  if (
    config.axiomToken !== undefined &&
    config.axiomDataset !== undefined &&
    config.nodeEnv !== 'test'
  ) {
    const axiom = new Axiom({ token: config.axiomToken });
    const dataset = config.axiomDataset;

    return {
      emit(record) {
        try {
          axiom.ingest(dataset, [{ ...record, _kind: AXIOM_DATASET_FIELD_NAME }]);
        } catch {
          // axiom buffers internally; ingest() is fire-and-forget. If the
          // client itself errors synchronously, swallow per Process #2 §12c
          // fail-open semantics (trace loss is logged via Sentry separately).
        }
      },
      flush: async () => {
        try {
          await axiom.flush();
        } catch {
          /* swallow */
        }
      },
    };
  }

  return {
    emit(record) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({ kind: 'turn-trace', dataset: AXIOM_DATASET_FIELD_NAME, ...record }),
      );
    },
    flush: async () => {
      /* nothing buffered */
    },
  };
}

/**
 * Helper for the common case: stamp `traceId`, `createdAt`, and emit.
 * Caller supplies the rest of the record.
 */
export function emitTurnTrace(
  emitter: TraceEmitter,
  traceId: string,
  partial: Omit<TurnTrace, 'traceId' | 'createdAt'>,
): void {
  emitter.emit({ ...partial, traceId, createdAt: new Date().toISOString() });
}
