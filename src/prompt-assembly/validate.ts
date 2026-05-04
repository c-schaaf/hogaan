import { isLevelTag, isPracticeTag } from '../shared/types/index.js';
import { PromptAssemblyError, type InputPayload } from './types.js';

/**
 * Process #9 §1 input validation. Returns the payload narrow-typed; throws
 * PromptAssemblyError(E5) on any structural problem. Cheap, synchronous.
 *
 * Tag presence is mode-dependent:
 *   - FullCoachingResponse, ProfileUpdateAcknowledgment, ScenarioRolePlay
 *     require both practiceTag + levelTag.
 *   - ClarifyingQuestion + MetaResponse skip them entirely.
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

  const tagsRequired =
    payload.responseMode === 'FullCoachingResponse' ||
    payload.responseMode === 'ProfileUpdateAcknowledgment' ||
    payload.responseMode === 'ScenarioRolePlay';

  if (tagsRequired) {
    if (payload.practiceTag === undefined || !isPracticeTag(payload.practiceTag)) {
      throw new PromptAssemblyError(
        `practiceTag required for mode ${payload.responseMode}`,
        'E5_MalformedInput',
      );
    }
    if (payload.levelTag === undefined || !isLevelTag(payload.levelTag)) {
      throw new PromptAssemblyError(
        `levelTag required for mode ${payload.responseMode}`,
        'E5_MalformedInput',
      );
    }
  }

  return payload;
}
