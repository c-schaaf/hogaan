import type { Database } from '../shared/db/client.js';
import { encryptPlaintext } from '../shared/db/encryption.js';
import { promptLogs } from '../shared/db/schema/prompt-logs.js';
import { reportIncident } from '../shared/observability/incidents.js';
import type { AppConfig } from '../shared/secrets/config.js';
import type { OutputBundle } from './types.js';
import type { InputPayload } from './types.js';

/**
 * Process #9 §14 — async prompt log writer. Fail-open: if the INSERT throws,
 * we log a P2 (informational — we lose audit data but the turn proceeds)
 * and the assembler returns logWriteFailed=true (E10).
 *
 * Caller pattern: don't await this in the hot path — invoke and let the
 * promise resolve in the background. Phase 4 returns the promise so tests
 * can await it.
 *
 * Encryption: full assembled prompt text → AES-256-GCM via the same
 * ENCRYPTION_KEY_BASE64 used for plaintext PII columns.
 */
export async function writePromptLog(
  config: AppConfig,
  db: Database,
  payload: InputPayload,
  bundle: OutputBundle,
): Promise<{ success: boolean }> {
  try {
    // SCRUM (PR 5) — `practiceTag` / `levelTag` columns dropped in
    // migration 0016. They were always null on the live path because the
    // tagger is stubbed.
    await db.insert(promptLogs).values({
      ...(payload.userId !== undefined ? { userId: payload.userId } : {}),
      ...(payload.sessionId !== undefined ? { sessionId: payload.sessionId } : {}),
      ...(payload.turnId !== undefined ? { turnId: payload.turnId } : {}),
      responseMode: payload.responseMode,
      promptTextEncrypted: encryptPlaintext(config, bundle.assembledPrompt),
      tokenCount: bundle.tokenCount,
      degradationFlags: bundle.degradationFlags,
      libraryVersions: {
        promptTemplates: bundle.libraryVersions.promptTemplates,
        voiceRules: bundle.libraryVersions.voiceRules,
        culturalFraming: bundle.libraryVersions.culturalFraming,
        resolvedAt: bundle.libraryVersions.resolvedAt.toISOString(),
      },
      determinismHash: bundle.determinismHash,
      logWriteRetried: false,
    });
    return { success: true };
  } catch (err) {
    reportIncident(
      'P2',
      'prompt_logs insert failed (fail-open)',
      {
        source: 'Process_9.Step_14_PromptLog',
        extra: { determinismHash: bundle.determinismHash, tokenCount: bundle.tokenCount },
      },
      err,
    );
    return { success: false };
  }
}
