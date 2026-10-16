// Model routing and prices (CLAUDE.md §8). The one place model IDs and prices live.
//
// Anthropic IDs and prices verified against the Anthropic model reference on 2026-10-15.
// Gemini is the development provider (owner decision 2026-10-15): free tier, so cost is
// logged as $0. Gemini uses the `-latest` aliases on purpose while it is dev-only; pin them
// if Gemini ever runs in production.

export const modelsVerifiedAt = '2026-10-15';

export const llmProviders = ['anthropic', 'gemini'] as const;
export type LlmProviderName = (typeof llmProviders)[number];

export const modelRoles = ['routine', 'writer', 'factCheck', 'launcher'] as const;
export type ModelRole = (typeof modelRoles)[number];

export const providerModels: Record<LlmProviderName, Record<ModelRole, string>> = {
  anthropic: {
    routine: 'claude-haiku-5-5',
    writer: 'claude-sonnet-5-5',
    factCheck: 'claude-sonnet-5-5',
    launcher: 'claude-opus-5-5',
  },
  gemini: {
    routine: 'gemini-flash-lite-latest',
    // Flash-Lite for writing and fact-checking too (owner's call, 2026-10-15): the free tier
    // allows only 20 requests a day on gemini-flash-latest. Weaker drafts and checks than Flash;
    // the code checks (verbatim quotes, names, numbers, tiers) are unchanged.
    writer: 'gemini-flash-lite-latest',
    factCheck: 'gemini-flash-lite-latest',
    launcher: 'gemini-pro-latest',
  },
};

/** Anthropic model IDs by role (kept for existing imports). */
export const models = providerModels.anthropic;

/** USD per million tokens. Thinking tokens are billed as output. */
export type ModelPrice = { input: number; output: number; cacheRead: number };

export const modelPrices: Record<string, ModelPrice> = {
  // Haiku 5.5 price applies to prompts up to 100K tokens; ours stay far below that.
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  // Free tier (development only).
  'gemini-flash-lite-latest': { input: 0, output: 0, cacheRead: 0 },
  'gemini-flash-latest': { input: 0, output: 0, cacheRead: 0 },
  'gemini-pro-latest': { input: 0, output: 0, cacheRead: 0 },
};

/**
 * Anthropic's server-side web search, USD per search (on top of tokens). Verified against the
 * Anthropic pricing page on 2026-10-16: $10 per 1,000 searches.
 */
export const WEB_SEARCH_USD = 0.01;

export type TokenUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number };

/** Estimated cost in USD. Throws for a model without a price, so nothing runs unpriced. */
export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const price = modelPrices[model];
  if (!price)
    throw new Error(`No price for model ${model}; add it to packages/config/src/models.ts`);
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead) /
    1_000_000
  );
}
