import type { TokenUsage } from '@towncore/config';

// The model-agnostic contract (CLAUDE.md §8). Providers turn one request into one JSON answer;
// everything else (spend caps, logging, validation) lives in llm.ts and never sees a vendor SDK.

export type Effort = 'low' | 'medium' | 'high';

export type LlmRequest = {
  model: string;
  /** Fixed per job and prompt version, so providers can cache it. */
  system: string;
  /** The per-call input (source records, draft, etc.). */
  input: string;
  /** JSON Schema the answer must follow (a portable subset: see llm.ts). */
  schema: Record<string, unknown>;
  effort: Effort;
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

export interface LlmProvider {
  readonly name: 'anthropic' | 'gemini' | 'replay';
  /** Whether `webSearch` requests are supported. */
  readonly webSearch?: boolean;
  /** Whether `images` are supported. */
  readonly images?: boolean;
  generate(request: LlmRequest): Promise<LlmResponse>;
}
