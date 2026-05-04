import { type AppConfig, requireConfig } from '../secrets/config.js';
import {
  LlmAuthError,
  LlmRateLimitError,
  LlmServiceUnavailableError,
  LlmTransientError,
} from './errors.js';
import { withTimeout } from './retry.js';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';

export interface VoyageEmbedRequest {
  model: 'voyage-3-lite';
  texts: string[];
  /** 'document' for the indexed corpus (memories, scenarios), 'query' for live retrieval. */
  inputType: 'document' | 'query';
  timeoutMs: number;
}

export interface VoyageEmbedResponse {
  /** Order matches the input texts. Each is a 1024-dim vector for voyage-3-lite. */
  embeddings: number[][];
  totalTokens: number;
}

export async function voyageEmbed(
  config: AppConfig,
  req: VoyageEmbedRequest,
): Promise<VoyageEmbedResponse> {
  const apiKey = requireConfig(config, 'voyageApiKey');

  return withTimeout('voyage', req.timeoutMs, async () => {
    const res = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        input: req.texts,
        input_type: req.inputType,
        truncation: true,
      }),
    });

    if (!res.ok) {
      throw mapVoyageStatus(res.status, await safeReadText(res));
    }

    const json = (await res.json()) as {
      data?: { embedding: number[]; index: number }[];
      usage?: { total_tokens?: number };
    };

    const data = json.data;
    if (!Array.isArray(data) || data.length === 0) {
      throw new LlmTransientError('voyage', 200, 'voyage returned empty data');
    }

    // Sort by `index` to preserve input order in case the API returns out-of-order.
    const sorted = [...data].sort((a, b) => a.index - b.index);
    return {
      embeddings: sorted.map((d) => d.embedding),
      totalTokens: json.usage?.total_tokens ?? 0,
    };
  });
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function mapVoyageStatus(status: number, body: string): Error {
  if (status === 401 || status === 403) {
    return new LlmAuthError('voyage', body);
  }
  if (status === 429) {
    return new LlmRateLimitError('voyage', body);
  }
  if (status >= 500 && status < 600) {
    return new LlmServiceUnavailableError('voyage', body);
  }
  return new LlmTransientError('voyage', status, body);
}
