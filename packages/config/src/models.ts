// Model routing and prices (CLAUDE.md §8). The one place model IDs and prices live.
//
// Anthropic IDs, prices and thinking controls verified against the Anthropic model reference on
// 2026-10-17.
// Gemini is the development provider (owner decision 2026-10-15): free tier, so cost is
// logged as $0. Gemini uses the `-latest` aliases on purpose while it is dev-only; pin them
// if Gemini ever runs in production.
import { loadEnv, type Env } from './env';

export const modelsVerifiedAt = '2026-10-17';

export const llmProviders = ['anthropic', 'gemini'] as const;
export type LlmProviderName = (typeof llmProviders)[number];

/**
 * Model sizes. Tasks name a size, never a model, so the provider can change underneath
 * (owner, 2026-10-17: "Every model call goes through llm.ts with a named task").
 */
export const modelTiers = ['small', 'mid', 'large'] as const;
export type ModelTier = (typeof modelTiers)[number];

export const providerModels: Record<LlmProviderName, Record<ModelTier, string>> = {
  anthropic: {
    small: 'claude-haiku-5-5',
    mid: 'claude-sonnet-5-5',
    large: 'claude-opus-5-5',
  },
  gemini: {
    // Flash-Lite for writing and fact-checking too (owner's call, 2026-10-15): the free tier
    // allows only 20 requests a day on gemini-flash-latest. Weaker drafts and checks than Flash;
    // the code checks (verbatim quotes, names, numbers, tiers) are unchanged.
    small: 'gemini-flash-lite-latest',
    mid: 'gemini-flash-lite-latest',
    large: 'gemini-pro-latest',
  },
};

/** Anthropic model IDs by size. */
export const models = providerModels.anthropic;

/**
 * How each model turns extended thinking off, where it can (verified 2026-10-17 against the
 * Anthropic model reference): Haiku 5.5 takes `disabled` at effort high or below; Sonnet 5.5
 * rejects `disabled` and uses `between_tools` (effort high or below); Opus 5.5 can't turn it
 * off, so effort is the only control.
 */
export const thinkingOff: Record<string, 'disabled' | 'between_tools' | null> = {
  'claude-haiku-5-5': 'disabled',
  'claude-sonnet-5-5': 'between_tools',
  'claude-opus-5-5': null,
};

/** USD per million tokens. Thinking tokens are billed as output. */
export type ModelPrice = {
  input: number;
  output: number;
  cacheRead: number;
  /** Writing the 5-minute prompt cache: 1.25x input. */
  cacheWrite: number;
};

const anthropicPrice = (input: number, output: number, cacheRead: number): ModelPrice => ({
  input,
  output,
  cacheRead,
  cacheWrite: input * 1.25,
});

export const modelPrices: Record<string, ModelPrice> = {
  // Haiku 5.5 price applies to prompts up to 100K tokens; ours stay far below that.
  'claude-haiku-5-5': anthropicPrice(0.1, 0.5, 0.01),
  'claude-sonnet-5-5': anthropicPrice(2, 10, 0.2),
  'claude-opus-5-5': anthropicPrice(4, 20, 0.2),
  // Free tier (development only).
  'gemini-flash-lite-latest': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  'gemini-flash-latest': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  'gemini-pro-latest': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

/** The Message Batches API bills every token, cache reads and writes included, at half price. */
export const BATCH_DISCOUNT = 0.5;

/**
 * Network-wide AI spend a day, across every town (docs/plans/M8.md, D-M8-2). Reaching it stops
 * model calls everywhere until midnight UTC and opens a critical alert.
 */
export const NETWORK_AI_DAILY_CAP_USD = 50;

/** The network cap in force: AI_NETWORK_CAP_USD when set (a first live run), else the default. */
export function networkAiCapUsd(env: Pick<Env, 'AI_NETWORK_CAP_USD'> = loadEnv()): number {
  return env.AI_NETWORK_CAP_USD ?? NETWORK_AI_DAILY_CAP_USD;
}

/**
 * Anthropic's server-side web search, USD per search (on top of tokens). Verified against the
 * Anthropic pricing page on 2026-10-16: $10 per 1,000 searches.
 */
export const WEB_SEARCH_USD = 0.01;

/** Uncached input, output, cache reads and cache writes (billed separately). */
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens?: number;
};

/** Estimated cost in USD. Throws for a model without a price, so nothing runs unpriced. */
export function estimateCostUsd(
  model: string,
  usage: TokenUsage,
  opts: { batch?: boolean } = {},
): number {
  const price = modelPrices[model];
  if (!price)
    throw new Error(`No price for model ${model}; add it to packages/config/src/models.ts`);
  const full =
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      (usage.cacheWriteTokens ?? 0) * price.cacheWrite) /
    1_000_000;
  return opts.batch ? full * BATCH_DISCOUNT : full;
}

// ---------------------------------------------------------------------------------------------
// The routing table (owner, 2026-10-17, "Claude model protocol"). Every model call names one of
// these tasks; this table alone decides the model size, thinking, effort, output limit, batching,
// escalation and caps. Code does everything it can first (roundups, alerts, tiers, quote and
// number checks), so these are only the calls a model is needed for.

export const aiTasks = [
  'classify',
  'extract',
  'write',
  'factcheck',
  'legal',
  'revise',
  'update',
  'guide',
  'guide-factcheck',
  'guide-revise',
  'discover',
  'identity',
  'theme-review',
  'reviewer',
  'meeting-split',
] as const;
export type AiTask = (typeof aiTasks)[number];

export type TaskRoute = {
  tier: ModelTier;
  /** `off` turns extended thinking off where the model allows it (thinkingOff). */
  thinking: 'off' | 'adaptive';
  effort: 'low' | 'medium' | 'high';
  /** max_tokens: thinking counts against it too. */
  maxOutputTokens: number;
  /** Through the Message Batches API (half price; results within 24 hours, usually 1). */
  batch?: boolean;
  /** Server-side web search, at most this many searches a call. */
  webSearch?: { maxUses: number };
  /** Retry once on a bigger model when the answer fails validation or reports low confidence. */
  escalate?: { to: ModelTier; confidenceBelow?: number };
  /** Network-wide spend on this task a day (UTC); reaching it stops the task until midnight. */
  dailyCapUsd: number;
  /** No single call may be estimated above this, at full price before caching. */
  maxCallUsd: number;
  /** Off until the owner switches it on (the AI article reviewer, Rule 5). */
  disabled?: boolean;
  /**
   * The prompt version this task uses where a newer one waits for recorded evals (writer v2).
   * A new version goes live by changing it here after `pnpm evals --live` records it.
   */
  promptVersion?: 'v1' | 'v2';
};

export const taskRoutes: Record<AiTask, TaskRoute> = {
  // Is it news, which beat, which town, who is named. Short structured output.
  classify: {
    tier: 'small',
    thinking: 'off',
    effort: 'low',
    maxOutputTokens: 1500,
    escalate: { to: 'mid', confidenceBelow: 0.6 },
    dailyCapUsd: 5,
    maxCallUsd: 0.05,
  },
  // Entities and fields from a published story.
  extract: {
    tier: 'small',
    thinking: 'off',
    effort: 'low',
    maxOutputTokens: 1500,
    escalate: { to: 'mid' },
    dailyCapUsd: 3,
    maxCallUsd: 0.05,
  },
  // The writer (its revise uses the same prompt version). v2 (length bands chosen in code, the
  // headline rules) waits for recorded evals: `pnpm evals --live --variant writer-v2`, then set
  // 'v2' here and re-record the baseline with `pnpm evals --live`.
  write: {
    tier: 'mid',
    thinking: 'off',
    effort: 'medium',
    maxOutputTokens: 6000,
    dailyCapUsd: 20,
    maxCallUsd: 0.25,
    promptVersion: 'v1',
  },
  // A separate call, never the writer's context (§6).
  factcheck: {
    tier: 'mid',
    thinking: 'off',
    effort: 'high',
    maxOutputTokens: 8000,
    dailyCapUsd: 15,
    maxCallUsd: 0.3,
  },
  // Libel review of Tier 1–2 drafts after fact-check (prompts v1/legal.ts): it can only raise a
  // story to review. Off until its eval responses are recorded and the owner switches it on.
  legal: {
    tier: 'mid',
    thinking: 'off',
    effort: 'high',
    maxOutputTokens: 3000,
    dailyCapUsd: 5,
    maxCallUsd: 0.15,
    disabled: true,
  },
  // The writer's one retry after a failed fact-check.
  revise: {
    tier: 'mid',
    thinking: 'off',
    effort: 'medium',
    maxOutputTokens: 6000,
    dailyCapUsd: 5,
    maxCallUsd: 0.25,
  },
  // A dated update note on a published story (§6a follow-ups).
  update: {
    tier: 'mid',
    thinking: 'off',
    effort: 'medium',
    maxOutputTokens: 3000,
    dailyCapUsd: 3,
    maxCallUsd: 0.15,
  },
  // Evergreen guides aren't time-sensitive: batched.
  guide: {
    tier: 'mid',
    thinking: 'off',
    effort: 'medium',
    maxOutputTokens: 8000,
    batch: true,
    dailyCapUsd: 5,
    maxCallUsd: 0.3,
  },
  'guide-factcheck': {
    tier: 'mid',
    thinking: 'off',
    effort: 'high',
    maxOutputTokens: 16000,
    batch: true,
    dailyCapUsd: 5,
    maxCallUsd: 0.4,
  },
  'guide-revise': {
    tier: 'mid',
    thinking: 'off',
    effort: 'medium',
    maxOutputTokens: 8000,
    batch: true,
    dailyCapUsd: 2,
    maxCallUsd: 0.3,
  },
  // Launcher source discovery, once per launch, inside the $25 launch cap.
  discover: {
    tier: 'large',
    thinking: 'adaptive',
    effort: 'medium',
    maxOutputTokens: 8000,
    webSearch: { maxUses: 12 },
    dailyCapUsd: 10,
    maxCallUsd: 2,
  },
  // Identity notes and the theme proposal. Opus or Sonnet: to be picked by eval.
  identity: {
    tier: 'large',
    thinking: 'adaptive',
    effort: 'medium',
    maxOutputTokens: 3000,
    dailyCapUsd: 5,
    maxCallUsd: 0.5,
  },
  // The screenshot review (images). Opus or Sonnet: to be picked by eval.
  'theme-review': {
    tier: 'large',
    thinking: 'adaptive',
    effort: 'medium',
    maxOutputTokens: 2500,
    dailyCapUsd: 5,
    maxCallUsd: 1,
  },
  // The AI article reviewer (later): off until the owner switches it on (Rule 5).
  reviewer: {
    tier: 'mid',
    thinking: 'adaptive',
    effort: 'high',
    maxOutputTokens: 4000,
    dailyCapUsd: 0,
    maxCallUsd: 0.3,
    disabled: true,
  },
  // One meeting's minutes into its decisions, one chunk a call; code checks every excerpt and
  // tally. Off until recorded with `pnpm evals --live`, then the owner turns it on by deleting
  // `disabled` (meeting recaps stay one story per meeting until then).
  'meeting-split': {
    tier: 'small',
    thinking: 'off',
    effort: 'low',
    maxOutputTokens: 4000,
    escalate: { to: 'mid' },
    dailyCapUsd: 3,
    maxCallUsd: 0.1,
    disabled: true,
  },
};

/** Tokens a character of English costs, rounded up for safety (the 5.x tokenizer counts ~30% more). */
const CHARS_PER_TOKEN = 3;
/** A screenshot sent for review, at most (images are resized before they are sent). */
const TOKENS_PER_IMAGE = 2500;
/** Context a single web search can add, at most. */
const TOKENS_PER_SEARCH = 6000;

/**
 * The most a call can cost, before it is sent: every input token at the uncached price, the
 * full output limit (thinking included), and every allowed search. Calls whose estimate passes
 * the task's `maxCallUsd` are refused.
 */
export function worstCaseCostUsd(
  model: string,
  route: Pick<TaskRoute, 'maxOutputTokens' | 'batch' | 'webSearch'>,
  input: { chars: number; images?: number },
): number {
  const searches = route.webSearch?.maxUses ?? 0;
  const inputTokens =
    Math.ceil(input.chars / CHARS_PER_TOKEN) +
    (input.images ?? 0) * TOKENS_PER_IMAGE +
    searches * TOKENS_PER_SEARCH;
  return (
    estimateCostUsd(
      model,
      { inputTokens, outputTokens: route.maxOutputTokens, cacheReadTokens: 0 },
      { batch: route.batch },
    ) +
    searches * WEB_SEARCH_USD
  );
}
