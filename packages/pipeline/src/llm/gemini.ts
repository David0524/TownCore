import type { LlmProvider, LlmRequest, LlmResponse } from './types';

// Google Gemini via the Interactions REST API (beta), checked against ai.google.dev on
// 2026-10-15: POST /v1beta/interactions with system_instruction, input, response_format
// (JSON schema) and generation_config. store=false keeps nothing on Google's side beyond what
// the free tier's terms allow. Development provider only (CLAUDE.md Decisions, 2026-10-15).

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

const thinkingLevel = { low: 'low', medium: 'medium', high: 'high' } as const;

type Interaction = {
  model?: string;
  status?: string;
  steps?: { type?: string; content?: { type?: string; text?: string }[] }[];
  usage?: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    total_thought_tokens?: number;
    total_cached_tokens?: number;
  };
  error?: { message?: string };
};

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class GeminiHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
  }
}

export type GeminiOptions = {
  /** Retries after a temporary failure (5xx, timeout, short rate limit). Default 2. */
  maxRetries?: number;
  /** Per-request timeout. Default 120 s. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const BACKOFF_MS = [5_000, 20_000];
/** A 429 asking to wait longer than this is a quota, not a blip: fail now, don't burn calls. */
const MAX_RATE_LIMIT_WAIT_MS = 60_000;

/**
 * Gemini with a short retry for temporary failures: 500/502/503/504 ("high demand"), timeouts,
 * and 429s that ask for a wait of a minute or less. Daily-quota 429s fail at once, since
 * retrying only uses up more of the quota.
 */
export function geminiProvider(
  apiKey: string,
  fetchFn: FetchLike = fetch,
  opts: GeminiOptions = {},
): LlmProvider {
  const once = geminiOnce(apiKey, fetchFn, opts.timeoutMs ?? 120_000);
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxRetries = opts.maxRetries ?? 2;
  return {
    name: 'gemini',
    async generate(request) {
      if (request.webSearch)
        throw new Error('Web search runs only on the Anthropic provider (D-M7-2).');
      if (request.images?.length)
        throw new Error('Image input runs only on the Anthropic provider.');
      for (let attempt = 0; ; attempt++) {
        try {
          return await once(request);
        } catch (error) {
          const wait = retryDelay(error, attempt);
          if (attempt >= maxRetries || wait === null) throw error;
          await sleep(wait);
        }
      }
    },
  };
}

function retryDelay(error: unknown, attempt: number): number | null {
  const backoff = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
  if (error instanceof GeminiHttpError) {
    if ([500, 502, 503, 504].includes(error.status)) return backoff;
    if (error.status === 429) {
      const wait = error.retryAfterMs ?? backoff;
      return wait <= MAX_RATE_LIMIT_WAIT_MS && !/per ?day|daily/i.test(error.message) ? wait : null;
    }
    return null;
  }
  // Network failures and timeouts.
  return error instanceof Error &&
    /timeout|aborted|fetch failed|ECONNRESET/i.test(`${error.name} ${error.message}`)
    ? backoff
    : null;
}

function geminiOnce(apiKey: string, fetchFn: FetchLike, timeoutMs: number) {
  return async (request: LlmRequest): Promise<LlmResponse> => {
    const response = await fetchFn(ENDPOINT, {
      signal: AbortSignal.timeout(timeoutMs),
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        model: request.model,
        store: false,
        system_instruction: request.system,
        input: request.input,
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: request.schema,
        },
        generation_config: {
          max_output_tokens: request.maxOutputTokens,
          thinking_level: thinkingLevel[request.effort],
        },
      }),
    });
    const body = (await response.json().catch(() => ({}))) as Interaction;
    if (!response.ok) {
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new GeminiHttpError(
        response.status,
        `Gemini HTTP ${response.status}: ${body.error?.message ?? response.statusText}`,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null,
      );
    }
    // The answer is the text of the last model_output step.
    const outputs = (body.steps ?? []).filter((step) => step.type === 'model_output');
    const last = outputs.at(-1);
    const text = (last?.content ?? [])
      .map((part) => (part.type === 'text' ? (part.text ?? '') : ''))
      .join('');
    const usage = body.usage ?? {};
    return {
      text,
      stop:
        body.status === 'completed'
          ? text
            ? 'end'
            : 'refusal'
          : body.status === 'incomplete'
            ? 'max_tokens'
            : 'other',
      model: body.model ?? request.model,
      usage: {
        inputTokens: usage.total_input_tokens ?? 0,
        // Thought tokens are billed as output.
        outputTokens: (usage.total_output_tokens ?? 0) + (usage.total_thought_tokens ?? 0),
        cacheReadTokens: usage.total_cached_tokens ?? 0,
      },
    };
  };
}
