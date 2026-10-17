import type { TokenUsage } from '@towncore/config';

// The model-agnostic contract (CLAUDE.md §8). Providers turn one request into one JSON answer;
// everything else (routing, spend caps, logging, validation) lives in llm.ts and never sees a
// vendor SDK.

export type Effort = 'low' | 'medium' | 'high';

export type LlmRequest = {
  model: string;
  /** Fixed per task and prompt version, so providers can cache it. */
  system: string;
  /**
   * Stable context sent before the per-call input (the town's name and agencies): cached after
   * the system prompt. Providers without caching send it joined to `input` by a newline.
   */
  inputPrefix?: string;
  /** The per-call input (source records, draft, etc.). */
  input: string;
  /** JSON Schema the answer must follow (a portable subset: see llm.ts). */
  schema: Record<string, unknown>;
  effort: Effort;
  /** `off` turns extended thinking off where the model allows it; `adaptive` lets it think. */
  thinking?: 'off' | 'adaptive';
  maxOutputTokens: number;
  /** Let the model search the web (launcher discovery only), at most this many searches. */
  webSearch?: { maxUses: number };
  /** Images sent with the input (the launcher's screenshot review), base64 PNG or JPEG. */
  images?: Array<{ mediaType: 'image/png' | 'image/jpeg'; data: string; label: string }>;
};

export type StopKind = 'end' | 'max_tokens' | 'refusal' | 'other';

export type LlmResponse = {
  text: string;
  stop: StopKind;
  /** The model that actually served the request. */
  model: string;
  usage: TokenUsage;
  /** Web searches the provider ran for this answer (billed per search). */
  webSearches?: number;
};

/** One answer from a finished batch: a response, or why the request failed. */
export type BatchResult = { response: LlmResponse } | { error: string };

/** Asynchronous half-price requests (Anthropic's Message Batches API). */
export interface BatchApi {
  /** Sends the requests as one batch; returns the batch ID. */
  submit(items: Array<{ customId: string; request: LlmRequest }>): Promise<string>;
  /** Whether the batch has ended, and if so each request's result by its custom ID. */
  poll(
    batchId: string,
  ): Promise<{ ended: false } | { ended: true; results: Map<string, BatchResult> }>;
}

export interface LlmProvider {
  readonly name: 'anthropic' | 'gemini' | 'replay';
  /** Whether `webSearch` requests are supported. */
  readonly webSearch?: boolean;
  /** Whether `images` are supported. */
  readonly images?: boolean;
  /** Batch support; without it, batch tasks run as ordinary calls. */
  readonly batch?: BatchApi;
  generate(request: LlmRequest): Promise<LlmResponse>;
}

/** The text a provider without caching sends: the stable prefix, then the per-call input. */
export const fullInput = (request: Pick<LlmRequest, 'inputPrefix' | 'input'>): string =>
  request.inputPrefix ? `${request.inputPrefix}\n${request.input}` : request.input;
