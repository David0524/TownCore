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

export function geminiProvider(apiKey: string, fetchFn: FetchLike = fetch): LlmProvider {
  return {
    name: 'gemini',
    async generate(request: LlmRequest): Promise<LlmResponse> {
      const response = await fetchFn(ENDPOINT, {
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
        throw new Error(
          `Gemini HTTP ${response.status}: ${body.error?.message ?? response.statusText}`,
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
    },
  };
}
