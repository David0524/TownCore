import Anthropic from '@anthropic-ai/sdk';
import type { LlmProvider, LlmRequest, LlmResponse, StopKind } from './types';

// Anthropic Messages API with structured output (output_config.format). Thinking stays at the
// model default (adaptive); effort sets its depth. A refusal is returned as such so the caller
// can send the item to human review instead of publishing.

// With `webSearch`, the server-side web search tool runs inside the request; a long search can
// pause the turn, which is continued (up to 3 times) by sending the partial answer back.

/** The most continuations of a paused (searching) turn before giving up. */
const MAX_CONTINUATIONS = 3;

export function anthropicProvider(client: Anthropic = new Anthropic()): LlmProvider {
  return {
    name: 'anthropic',
    webSearch: true,
    images: true,
    async generate(request: LlmRequest): Promise<LlmResponse> {
      // Images go first, each introduced by its label, then the text input.
      const content: Anthropic.ContentBlockParam[] | string = request.images?.length
        ? [
            ...request.images.flatMap((image): Anthropic.ContentBlockParam[] => [
              { type: 'text', text: image.label },
              {
                type: 'image',
                source: { type: 'base64', media_type: image.mediaType, data: image.data },
              },
            ]),
            { type: 'text', text: request.input },
          ]
        : request.input;
      const messages: Anthropic.MessageParam[] = [{ role: 'user', content }];
      const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
      let webSearches = 0;
      let message: Anthropic.Message;
      for (let turn = 0; ; turn++) {
        message = await client.messages.create({
          model: request.model,
          max_tokens: request.maxOutputTokens,
          system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
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
          output_config: {
            effort: request.effort,
            format: { type: 'json_schema', schema: request.schema },
          },
        });
        usage.inputTokens +=
          message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0);
        usage.outputTokens += message.usage.output_tokens;
        usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
        webSearches += message.usage.server_tool_use?.web_search_requests ?? 0;
        if (message.stop_reason !== 'pause_turn' || turn >= MAX_CONTINUATIONS) break;
        messages.push({ role: 'assistant', content: message.content });
      }
      // With tools, the JSON answer is the last text block (earlier ones narrate the search).
      const texts = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
      const text = request.webSearch ? (texts.at(-1) ?? '') : texts.join('');
      const stop: StopKind =
        message.stop_reason === 'end_turn'
          ? 'end'
          : message.stop_reason === 'max_tokens'
            ? 'max_tokens'
            : message.stop_reason === 'refusal'
              ? 'refusal'
              : 'other';
      return { text, stop, model: message.model, usage, webSearches };
    },
  };
}
