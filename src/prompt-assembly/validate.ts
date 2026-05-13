import { PromptAssemblyError, type InputPayload } from './types.js';

/**
 * Process #9 §1 input validation. Returns the payload narrow-typed; throws
 * PromptAssemblyError(E5) on any structural problem. Cheap, synchronous.
 *
 * 2026-05-13: the prior mode-dependent practiceTag + levelTag presence
 * check was removed. Under coaching_v0_unified the assembler short-
 * circuits the practice + level framing blocks entirely, so the tags
 * are not load-bearing for any active code path. Callers that supply
 * them are still respected (e.g., legacy callers that go through the
 * full orchestrator); callers that omit them just no-op the validator.
 * The tagger itself is also stubbed (see Step 6 banner in
 * src/coaching/orchestrator.ts). To restore the strict check, revert
 * this commit and re-enable the tagger.
 */
export function validateInputPayload(payload: InputPayload): InputPayload {
  if (typeof payload.userMessage !== 'string' || payload.userMessage.length === 0) {
    throw new PromptAssemblyError('userMessage is required and non-empty', 'E5_MalformedInput');
  }

  if (
    !Array.isArray(payload.retrievedMemories) ||
    !Array.isArray(payload.sessionTurns) ||
    payload.userProfile === null ||
    typeof payload.userProfile !== 'object'
  ) {
    throw new PromptAssemblyError('payload missing required collections', 'E5_MalformedInput');
  }

  return payload;
}
