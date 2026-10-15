// Model routing (CLAUDE.md §8). Placeholder until M3: verify the IDs and pricing
// against the Anthropic docs before anything calls a model.
export const models = {
  routine: 'claude-haiku-5-5',
  writer: 'claude-sonnet-5-5',
  factCheck: 'claude-sonnet-5-5',
  launcher: 'claude-opus-5-5',
} as const;
