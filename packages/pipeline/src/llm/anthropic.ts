import Anthropic from '@anthropic-ai/sdk';
import type { LlmProvider, LlmRequest, LlmResponse, StopKind } from './types';

// Anthropic Messages API with structured output (output_config.format). Thinking stays at the
// model default (adaptive); effort sets its depth. A refusal is returned as such so the caller
// can send the item to human review instead of publishing.

export function anthropicProvider(client: Anthropic = new Anthropic()): LlmProvider {
  return {
    name: 'anthropic',
    async generate(request: LlmRequest): Promise<LlmResponse> {
      const message = await client.messages.create({
        model: request.model,
        max_tokens: request.maxOutputTokens,
        system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: request.input }],
        output_config: {
          effort: request.effort,
          format: { type: 'json_schema', schema: request.schema },
        },
      });
      const text = message.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('');
      const stop: StopKind =
        message.stop_reason === 'end_turn'
          ? 'end'
          : message.stop_reason === 'max_tokens'
            ? 'max_tokens'
            : message.stop_reason === 'refusal'
              ? 'refusal'
              : 'other';
      return {
        text,
        stop,
        model: message.model,
        usage: {
          inputTokens:
            message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0),
          outputTokens: message.usage.output_tokens,
          cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        },
      };
    },
  };
}
