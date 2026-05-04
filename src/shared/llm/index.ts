export {
  LlmError,
  LlmTimeoutError,
  LlmRateLimitError,
  LlmContentFilterError,
  LlmServiceUnavailableError,
  LlmAuthError,
  LlmTransientError,
  LlmCircuitOpenError,
  shouldFallbackToFastModel,
  shouldUseSafeTemplate,
  isFailClosedLlmError,
} from './errors.js';

export { withRetry, withTimeout, type RetryOptions } from './retry.js';

export { buildBreaker, type BreakerOptions, type Provider } from './breaker.js';

export {
  anthropicChat,
  resetAnthropicClientForTests,
  type AnthropicChatRequest,
  type AnthropicChatResponse,
} from './anthropic.js';

export {
  groqChat,
  resetGroqClientForTests,
  type GroqChatRequest,
  type GroqChatResponse,
} from './groq.js';

export { voyageEmbed, type VoyageEmbedRequest, type VoyageEmbedResponse } from './voyage.js';

export {
  chat,
  resetChatBreakersForTests,
  type ChatRequest,
  type ChatResponse,
  type ModelUsed,
  type FallbackPath,
} from './chat.js';
