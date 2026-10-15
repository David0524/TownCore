import {
  estimateCostUsd,
  loadEnv,
  providerModels,
  type Env,
  type LlmProviderName,
  type ModelRole,
  type TokenUsage,
} from '@towncore/config';
import { aiUsage, and, eq, gte, sql, type Db } from '@towncore/db';
import { z } from 'zod';
import { anthropicProvider } from './llm/anthropic';
import { geminiProvider } from './llm/gemini';
import type { Effort, LlmProvider, LlmResponse } from './llm/types';

// The pipeline's only door to a model (CLAUDE.md §8). Every call:
//   1. checks the town's daily spend and call caps,
//   2. asks the configured provider for JSON that follows the prompt's schema,
//   3. logs an ai_usage row (also for refusals, bad output and errors),
//   4. returns a zod-validated value, or throws LlmOutputError.
// Nothing else in the repo imports a model SDK.

export type { Effort, LlmProvider, LlmRequest, LlmResponse } from './llm/types';
export { recordingProvider, replayProvider, requestKey } from './llm/replay';

/** A versioned prompt: fixed system text plus the schema its answer must follow. */
export type Prompt<T> = {
  id: string;
  version: string;
  role: ModelRole;
  effort: Effort;
  maxOutputTokens: number;
  system: string;
  schema: z.ZodType<T>;
};

export type LlmTown = {
  id: string;
  timezone: string;
  aiDailyCapUsd: number;
  aiDailyCallCap: number;
};

export type Llm = {
  providerName: LlmProviderName;
  provider: LlmProvider;
  db: Db;
  now?: () => Date;
};

export class SpendCapReached extends Error {
  constructor(
    readonly townId: string,
    detail: string,
  ) {
    super(`AI daily cap reached for town ${townId}: ${detail}`);
  }
}

export class LlmOutputError extends Error {
  constructor(
    readonly kind: 'refusal' | 'invalid' | 'max_tokens',
    message: string,
  ) {
    super(message);
  }
}

/** Chooses the provider from the environment: LLM_PROVIDER, else Anthropic if keyed, else Gemini. */
export function resolveProviderName(env: Env = loadEnv()): LlmProviderName | undefined {
  if (env.LLM_PROVIDER) return env.LLM_PROVIDER;
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.GEMINI_API_KEY) return 'gemini';
  return undefined;
}

export function providerFromEnv(env: Env = loadEnv()): {
  name: LlmProviderName;
  provider: LlmProvider;
} {
  const name = resolveProviderName(env);
  if (name === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) throw new Error('LLM_PROVIDER=anthropic needs ANTHROPIC_API_KEY');
    return { name, provider: anthropicProvider() };
  }
  if (name === 'gemini') {
    if (!env.GEMINI_API_KEY) throw new Error('LLM_PROVIDER=gemini needs GEMINI_API_KEY');
    return { name, provider: geminiProvider(env.GEMINI_API_KEY) };
  }
  throw new Error('No model provider configured: set ANTHROPIC_API_KEY or GEMINI_API_KEY.');
}

// Value constraints that not every provider's structured output accepts. They are dropped
// from what the model sees; the zod schema still enforces them on the answer.
const VALUE_CONSTRAINTS = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minItems',
  'maxItems',
];

/**
 * JSON Schema both providers accept: no $schema, every object closed, no value constraints.
 * Prompts use only required fields (nullable instead of optional), strings, numbers,
 * booleans, enums and arrays.
 */
export function portableSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  const close = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(close);
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (obj.type === 'object') obj.additionalProperties = false;
    for (const key of VALUE_CONSTRAINTS) {
      if (typeof obj[key] !== 'object') delete obj[key];
    }
    Object.values(obj).forEach(close);
  };
  close(json);
  return json;
}

/** Spend and call count so far today, in the town's own timezone. */
export async function todaysUsage(
  db: Db,
  town: Pick<LlmTown, 'id' | 'timezone'>,
  now: Date,
): Promise<{ costUsd: number; calls: number }> {
  const startOfDay = sql`(date_trunc('day', ${now.toISOString()}::timestamptz at time zone ${town.timezone}) at time zone ${town.timezone})`;
  const [row] = await db
    .select({
      cost: sql<string>`coalesce(sum(${aiUsage.estCostUsd}), 0)`,
      calls: sql<number>`count(*)::int`,
    })
    .from(aiUsage)
    .where(and(eq(aiUsage.townId, town.id), gte(aiUsage.createdAt, startOfDay)));
  return { costUsd: Number(row?.cost ?? 0), calls: row?.calls ?? 0 };
}

export type CallResult<T> = {
  value: T;
  model: string;
  usage: TokenUsage;
  costUsd: number;
};

export async function callModel<T>(
  llm: Llm,
  args: { job: string; town: LlmTown; prompt: Prompt<T>; input: string },
): Promise<CallResult<T>> {
  const { db, provider, providerName } = llm;
  const { job, town, prompt, input } = args;
  const now = llm.now?.() ?? new Date();

  const today = await todaysUsage(db, town, now);
  if (today.costUsd >= town.aiDailyCapUsd) {
    throw new SpendCapReached(town.id, `$${today.costUsd.toFixed(2)} of $${town.aiDailyCapUsd}`);
  }
  if (today.calls >= town.aiDailyCallCap) {
    throw new SpendCapReached(town.id, `${today.calls} of ${town.aiDailyCallCap} calls`);
  }

  const model = providerModels[providerName][prompt.role];
  const log = async (
    outcome: 'ok' | 'refused' | 'invalid' | 'error',
    response?: LlmResponse,
  ): Promise<number> => {
    const usage = response?.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    const servedBy = response?.model ?? model;
    const costUsd = estimateCostUsd(priceKey(servedBy, model), usage);
    await db.insert(aiUsage).values({
      townId: town.id,
      job,
      model: servedBy,
      provider: providerName,
      promptVersion: `${prompt.id}@${prompt.version}`,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      estCostUsd: costUsd.toFixed(6),
      outcome,
      createdAt: now,
    });
    return costUsd;
  };

  let response: LlmResponse;
  try {
    response = await provider.generate({
      model,
      system: prompt.system,
      input,
      schema: portableSchema(prompt.schema),
      effort: prompt.effort,
      maxOutputTokens: prompt.maxOutputTokens,
    });
  } catch (error) {
    await log('error');
    throw error;
  }

  if (response.stop === 'refusal') {
    await log('refused', response);
    throw new LlmOutputError('refusal', `${prompt.id}: the model declined the request`);
  }
  if (response.stop === 'max_tokens') {
    await log('invalid', response);
    throw new LlmOutputError('max_tokens', `${prompt.id}: output hit the token limit`);
  }
  let parsed: z.ZodSafeParseResult<T>;
  try {
    parsed = prompt.schema.safeParse(JSON.parse(response.text));
  } catch {
    await log('invalid', response);
    throw new LlmOutputError('invalid', `${prompt.id}: output was not JSON`);
  }
  if (!parsed.success) {
    await log('invalid', response);
    throw new LlmOutputError(
      'invalid',
      `${prompt.id}: output failed its schema:\n${z.prettifyError(parsed.error)}`,
    );
  }
  const costUsd = await log('ok', response);
  return { value: parsed.data, model: response.model, usage: response.usage, costUsd };
}

// A provider may report a dated model name (e.g. "gemini-3.6-flash" for gemini-flash-latest);
// price it as the configured model when the served name has no price of its own.
function priceKey(servedBy: string, configured: string): string {
  try {
    estimateCostUsd(servedBy, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
    return servedBy;
  } catch {
    return configured;
  }
}
