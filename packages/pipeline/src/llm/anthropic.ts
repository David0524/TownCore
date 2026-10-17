import Anthropic from '@anthropic-ai/sdk';
import { thinkingOff } from '@towncore/config';
import type {
  BatchApi,
  BatchResult,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  StopKind,
} from './types';

// Anthropic Messages API with structured output (output_config.format). The routing table
// (packages/config/src/models.ts) sets each task's thinking, effort and output limit; a refusal
// is returned as such so the caller can send the item to human review instead of publishing.
//
// Caching: the system prompt is the first cache breakpoint; a stable input prefix (the town's
// context) is the second, so each town's calls read both from the cache within five minutes.
//
// With `webSearch`, the server-side web search tool runs inside the request; a long search can
// pause the turn, which is continued (up to 3 times) by sending the partial answer back.
//
// Retries: the SDK backs off and retries 429, 5xx and 529 (overloaded) responses, honouring
// retry-after, at most MAX_RETRIES times. A call that succeeded is never sent again: llm.ts keeps
// every answer by its request key (ai_requests).

/** The most continuations of a paused (searching) turn before giving up. */
const MAX_CONTINUATIONS = 3;
/** Retries of 429, 5xx and 529 responses, with the SDK's exponential backoff. */
export const MAX_RETRIES = 3;
/** One request's time limit: generous for a long fact-check. */
const TIMEOUT_MS = 180_000;

const ephemeral = { type: 'ephemeral' as const };

/** The `thinking` field for a request, or none (the model's default, adaptive). */
function thinkingParam(request: LlmRequest): Record<string, unknown> {
  if (request.thinking !== 'off') return {};
  const off = thinkingOff[request.model];
  // Opus 5.5 can't turn thinking off: low effort is its only control.
  return off ? { thinking: { type: off } } : {};
}

/** The Messages API parameters for one request (shared by direct calls and batches). */
export function messageParams(
  request: LlmRequest,
  messages: Anthropic.MessageParam[] = [{ role: 'user', content: userContent(request) }],
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: request.model,
    max_tokens: request.maxOutputTokens,
    system: [{ type: 'text', text: request.system, cache_control: ephemeral }],
    messages,
    ...(request.webSearch
      ? {
          tools: [
            {
              type: 'web_search_20250305',
              name: 'web_search',
              max_uses: request.webSearch.maxUses,
            },
          ],
        }
      : {}),
    ...thinkingParam(request),
    output_config: {
      effort: request.effort,
      format: { type: 'json_schema', schema: request.schema },
    },
  } as Anthropic.MessageCreateParamsNonStreaming;
}

/** The user turn: the cached town prefix, any images (each after its label), then the input. */
function userContent(request: LlmRequest): Anthropic.ContentBlockParam[] | string {
  if (!request.inputPrefix && !request.images?.length) return request.input;
  return [
    ...(request.inputPrefix
      ? [{ type: 'text' as const, text: request.inputPrefix, cache_control: ephemeral }]
      : []),
    ...(request.images ?? []).flatMap((image): Anthropic.ContentBlockParam[] => [
      { type: 'text', text: image.label },
      {
        type: 'image',
        source: { type: 'base64', media_type: image.mediaType, data: image.data },
      },
    ]),
    { type: 'text', text: request.input },
  ];
}

const usageOf = (u: Anthropic.Usage) => ({
  inputTokens: u.input_tokens,
  outputTokens: u.output_tokens,
  cacheReadTokens: u.cache_read_input_tokens ?? 0,
  cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
});

const stopOf = (reason: Anthropic.Message['stop_reason']): StopKind =>
  reason === 'end_turn'
    ? 'end'
    : reason === 'max_tokens'
      ? 'max_tokens'
      : reason === 'refusal'
        ? 'refusal'
        : 'other';

/** The answer text: with tools, the JSON is the last text block (earlier ones narrate). */
function answerText(message: Anthropic.Message, tools: boolean): string {
  const texts = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
  return tools ? (texts.at(-1) ?? '') : texts.join('');
}

export function anthropicProvider(
  client: Anthropic = new Anthropic({ maxRetries: MAX_RETRIES, timeout: TIMEOUT_MS }),
): LlmProvider {
  const batch: BatchApi = {
    async submit(items) {
      for (const { request } of items)
        if (request.webSearch) throw new Error('Web search requests are never batched.');
      const created = await client.messages.batches.create({
        requests: items.map((item) => ({
          custom_id: item.customId,
          params: messageParams(item.request),
        })),
      });
      return created.id;
    },
    async poll(batchId) {
      const status = await client.messages.batches.retrieve(batchId);
      if (status.processing_status !== 'ended') return { ended: false };
      const results = new Map<string, BatchResult>();
      for await (const item of await client.messages.batches.results(batchId)) {
        const r = item.result;
        results.set(
          item.custom_id,
          r.type === 'succeeded'
            ? {
                response: {
                  text: answerText(r.message, false),
                  stop: stopOf(r.message.stop_reason),
                  model: r.message.model,
                  usage: usageOf(r.message.usage),
                  webSearches: 0,
                },
              }
            : { error: r.type === 'errored' ? `errored: ${r.error.error.type}` : r.type },
        );
      }
      return { ended: true, results };
    },
  };

  return {
    name: 'anthropic',
    webSearch: true,
    images: true,
    batch,
    async generate(request: LlmRequest): Promise<LlmResponse> {
      const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userContent(request) }];
      const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      let webSearches = 0;
      let message: Anthropic.Message;
      for (let turn = 0; ; turn++) {
        message = await client.messages.create(messageParams(request, messages));
        const u = usageOf(message.usage);
        usage.inputTokens += u.inputTokens;
        usage.outputTokens += u.outputTokens;
        usage.cacheReadTokens += u.cacheReadTokens;
        usage.cacheWriteTokens += u.cacheWriteTokens;
        webSearches += message.usage.server_tool_use?.web_search_requests ?? 0;
        if (message.stop_reason !== 'pause_turn' || turn >= MAX_CONTINUATIONS) break;
        messages.push({ role: 'assistant', content: message.content });
      }
      return {
        text: answerText(message, Boolean(request.webSearch)),
        stop: stopOf(message.stop_reason),
        model: message.model,
        usage,
        webSearches,
      };
    },
  };
}
