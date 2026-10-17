import { createHash } from 'node:crypto';
import {
  estimateCostUsd,
  loadEnv,
  networkAiCapUsd,
  WEB_SEARCH_USD,
  providerModels,
  taskRoutes,
  worstCaseCostUsd,
  type AiTask,
  type Env,
  type LlmProviderName,
  type ModelTier,
  type TaskRoute,
  type TokenUsage,
} from '@towncore/config';
import { aiRequests, aiUsage, and, eq, gte, inArray, lt, sql, type Db } from '@towncore/db';
import { z } from 'zod';
import { anthropicProvider } from './llm/anthropic';
import { geminiProvider } from './llm/gemini';
import { fullInput, type LlmProvider, type LlmRequest, type LlmResponse } from './llm/types';

// The pipeline's only door to a model (CLAUDE.md §8; owner, 2026-10-17, "Claude model protocol").
// Every call names a task, never a model. The routing table (packages/config/src/models.ts) gives
// the task's model size, thinking, effort, output limit, batching, escalation and caps. Each call:
//   1. returns the stored answer if this exact request already succeeded (never sent twice),
//   2. checks the caps: network, town, task, and the call's own worst-case cost estimate,
//   3. sends it (or, for a batch task, queues it for the worker's next batch),
//   4. logs an ai_usage row with task, model, input, output and cached tokens, cost and
//      escalation (also for refusals, bad output and errors),
//   5. returns a zod-validated value, escalating once to a bigger model on invalid output or
//      low confidence where the task allows it, or throws LlmOutputError.
// A cap is never a reason to switch to a bigger model: it stops the work. Nothing else in the
// repo imports a model SDK.

export type { BatchApi, Effort, LlmProvider, LlmRequest, LlmResponse } from './llm/types';
export { NotRecordedError, recordingProvider, replayProvider, requestKey } from './llm/replay';

/** A versioned prompt: fixed system text plus the schema its answer must follow. */
export type Prompt<T> = {
  id: string;
  version: string;
  /** The routing-table task this prompt serves (a caller may name a related one: `revise`). */
  task: AiTask;
  system: string;
  schema: z.ZodType<T>;
  /**
   * A version for one provider, where its prompt differs (Claude's classify reports its
   * confidence). The answer still satisfies T. Recordings of the default stay valid.
   */
  variants?: Partial<Record<LlmProviderName, Prompt<T>>>;
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
  /** Per-run route changes, for evals that compare models or thinking (never in production). */
  routeOverrides?: Partial<Record<AiTask, Partial<TaskRoute>>>;
};

export class SpendCapReached extends Error {
  constructor(
    readonly townId: string,
    detail: string,
  ) {
    super(`AI cap reached for town ${townId}: ${detail}`);
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

/** A batch task's request is queued or in a batch; the caller tries again on a later run. */
export class BatchPending extends Error {
  constructor(readonly task: AiTask) {
    super(`${task}: waiting for the batch to finish`);
  }
}

/** The task is switched off in the routing table (the AI reviewer, until the owner turns it on). */
export class TaskDisabled extends Error {
  constructor(readonly task: AiTask) {
    super(`${task} is switched off in the routing table`);
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

const startOfUtcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** AI spend across every town since `from` (one task's, when given). */
export async function networkSpendSince(db: Db, from: Date, task?: AiTask): Promise<number> {
  const [row] = await db
    .select({ cost: sql<string>`coalesce(sum(${aiUsage.estCostUsd}), 0)` })
    .from(aiUsage)
    .where(and(gte(aiUsage.createdAt, from), task ? eq(aiUsage.task, task) : undefined));
  return Number(row?.cost ?? 0);
}

/** Worst-case cost of batch requests not answered yet: counted against the caps like spend. */
async function pendingBatchUsd(db: Db, townId: string | null, task?: AiTask): Promise<number> {
  const [row] = await db
    .select({
      usd: sql<string>`coalesce(sum((${aiRequests.request}->>'estimateUsd')::numeric), 0)`,
    })
    .from(aiRequests)
    .where(
      and(
        inArray(aiRequests.status, ['queued', 'submitted']),
        townId ? eq(aiRequests.townId, townId) : undefined,
        task ? eq(aiRequests.task, task) : undefined,
      ),
    );
  return Number(row?.usd ?? 0);
}

/** A task's route, with any per-run override (evals). */
export function routeFor(llm: Pick<Llm, 'routeOverrides'>, task: AiTask): TaskRoute {
  return { ...taskRoutes[task], ...llm.routeOverrides?.[task] };
}

/** The model a task runs on for a provider (the escalation size when given). */
export function modelFor(provider: LlmProviderName, route: TaskRoute, tier?: ModelTier): string {
  return providerModels[provider][tier ?? route.tier];
}

export type CallResult<T> = {
  value: T;
  model: string;
  usage: TokenUsage;
  costUsd: number;
  /** Answered by a bigger model after low confidence or invalid output. */
  escalated: boolean;
  /** The stored answer of an identical earlier request: no model call, no new cost. */
  reused: boolean;
};

type CallArgs<T> = {
  job: string;
  town: LlmTown;
  prompt: Prompt<T>;
  /** The routing task, when it differs from the prompt's own (a revise uses the writer prompt). */
  task?: AiTask;
  /** Stable context (the town), cached after the system prompt. Joined before `input`. */
  inputPrefix?: string;
  input: string;
  images?: LlmRequest['images'];
};

/**
 * The idempotency key: the same task, provider, model, prompt and input is the same request.
 * Kept per town, so one town's answer is never another's.
 */
function idempotencyKey(townId: string, task: AiTask, provider: string, request: LlmRequest) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        townId,
        task,
        provider,
        request.model,
        request.system,
        fullInput(request),
        request.schema,
        request.thinking,
        request.effort,
        (request.images ?? []).map((i) => createHash('sha256').update(i.data).digest('hex')),
      ]),
    )
    .digest('hex');
}

/** A numeric `confidence` the answer reports, if its schema has one. */
const confidenceOf = (value: unknown): number | null =>
  value &&
  typeof value === 'object' &&
  typeof (value as { confidence?: unknown }).confidence === 'number'
    ? (value as { confidence: number }).confidence
    : null;

export async function callModel<T>(llm: Llm, args: CallArgs<T>): Promise<CallResult<T>> {
  const task = args.task ?? args.prompt.task;
  const route = routeFor(llm, task);
  if (route.disabled) throw new TaskDisabled(task);
  try {
    return await attempt(llm, args, task, route, route.tier, false);
  } catch (error) {
    const escalation = route.escalate;
    if (escalation && error instanceof EscalationNeeded) {
      return attempt(llm, args, task, route, escalation.to, true);
    }
    if (error instanceof EscalationNeeded) throw error.cause;
    throw error;
  }
}

/** Internal: the first answer was invalid or unsure, and the task escalates. */
class EscalationNeeded extends Error {
  constructor(override readonly cause: Error | null) {
    super('escalate');
  }
}

async function attempt<T>(
  llm: Llm,
  args: CallArgs<T>,
  task: AiTask,
  route: TaskRoute,
  tier: ModelTier,
  escalated: boolean,
): Promise<CallResult<T>> {
  const { db, provider, providerName } = llm;
  const { job, town, input } = args;
  const prompt = args.prompt.variants?.[providerName] ?? args.prompt;
  const now = llm.now?.() ?? new Date();

  if (route.webSearch && !provider.webSearch)
    throw new Error(`${task} needs web search, which the ${providerName} provider lacks.`);
  if (args.images?.length && !provider.images)
    throw new Error(`${task} sends images, which the ${providerName} provider can't read.`);

  const model = modelFor(providerName, route, tier);
  const request: LlmRequest = {
    model,
    system: prompt.system,
    ...(args.inputPrefix ? { inputPrefix: args.inputPrefix } : {}),
    input,
    schema: portableSchema(prompt.schema),
    effort: route.effort,
    thinking: route.thinking,
    maxOutputTokens: route.maxOutputTokens,
    ...(route.webSearch ? { webSearch: route.webSearch } : {}),
    ...(args.images?.length ? { images: args.images } : {}),
  };
  const batch = Boolean(route.batch && provider.batch);
  const key = idempotencyKey(town.id, task, providerName, request);
  const promptVersion = `${prompt.id}@${prompt.version}`;

  const log = async (
    outcome: 'ok' | 'refused' | 'invalid' | 'low_confidence' | 'error',
    response?: LlmResponse,
  ): Promise<number> => {
    const usage = response?.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    const servedBy = response?.model ?? model;
    const costUsd =
      estimateCostUsd(priceKey(servedBy, model), usage) +
      (response?.webSearches ?? 0) * WEB_SEARCH_USD;
    await db.insert(aiUsage).values({
      townId: town.id,
      job,
      task,
      model: servedBy,
      provider: providerName,
      promptVersion,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
      estCostUsd: costUsd.toFixed(6),
      outcome,
      escalated,
      createdAt: now,
    });
    return costUsd;
  };

  // 1. An identical request that already succeeded (or is waiting in a batch).
  const [stored] = await db.select().from(aiRequests).where(eq(aiRequests.key, key));
  if (stored?.status === 'queued' || stored?.status === 'submitted') throw new BatchPending(task);
  if (stored?.status === 'succeeded' && stored.response) {
    const response = stored.response as LlmResponse;
    const value = validate(prompt, task, response);
    if (value instanceof LlmOutputError) {
      // A batch answer that fails its schema: logged when collected; escalate or give up.
      await db
        .update(aiRequests)
        .set({ status: 'failed', error: value.message })
        .where(eq(aiRequests.id, stored.id));
      if (!escalated && value.kind === 'invalid' && route.escalate)
        throw new EscalationNeeded(value);
      throw value;
    }
    const costUsd = 0;
    return {
      value,
      model: response.model,
      usage: response.usage,
      costUsd,
      escalated,
      reused: true,
    };
  }
  if (stored?.status === 'failed') await db.delete(aiRequests).where(eq(aiRequests.id, stored.id));

  // 2. The caps, against the call's worst case: it can't push any of them over.
  const estimate = worstCaseCostUsd(model, route, {
    chars: request.system.length + fullInput(request).length,
    images: request.images?.length,
  });
  if (estimate > route.maxCallUsd) {
    throw new SpendCapReached(
      town.id,
      `one ${task} call could cost $${estimate.toFixed(3)}, over its $${route.maxCallUsd} limit`,
    );
  }
  const dayStart = startOfUtcDay(now);
  const network = (await networkSpendSince(db, dayStart)) + (await pendingBatchUsd(db, null));
  if (network + estimate > networkAiCapUsd()) {
    throw new SpendCapReached(
      town.id,
      `network-wide $${network.toFixed(2)} of $${networkAiCapUsd()} today`,
    );
  }
  const taskSpent =
    (await networkSpendSince(db, dayStart, task)) + (await pendingBatchUsd(db, null, task));
  if (taskSpent + estimate > route.dailyCapUsd) {
    throw new SpendCapReached(
      town.id,
      `${task}: $${taskSpent.toFixed(2)} of its $${route.dailyCapUsd} today`,
    );
  }
  const today = await todaysUsage(db, town, now);
  const townSpent = today.costUsd + (await pendingBatchUsd(db, town.id));
  if (townSpent + estimate > town.aiDailyCapUsd) {
    throw new SpendCapReached(town.id, `$${townSpent.toFixed(2)} of $${town.aiDailyCapUsd}`);
  }
  if (today.calls >= town.aiDailyCallCap) {
    throw new SpendCapReached(town.id, `${today.calls} of ${town.aiDailyCallCap} calls`);
  }

  // 3a. A batch task: queued for the worker's next batch (runAiBatches).
  if (batch) {
    await db
      .insert(aiRequests)
      .values({
        key,
        townId: town.id,
        task,
        job,
        provider: providerName,
        model,
        status: 'queued',
        // The request as a string: jsonb would reorder its keys, and the request must go out
        // exactly as built (replay keys hash it).
        request: { json: JSON.stringify(request), estimateUsd: estimate, promptVersion, escalated },
        createdAt: now,
      })
      .onConflictDoNothing();
    throw new BatchPending(task);
  }

  // 3b. A direct call.
  let response: LlmResponse;
  try {
    response = await provider.generate(request);
  } catch (error) {
    await log('error');
    throw error;
  }
  if (response.stop === 'refusal') {
    await log('refused', response);
    throw new LlmOutputError('refusal', `${task}: the model declined the request`);
  }
  if (response.stop === 'max_tokens') {
    await log('invalid', response);
    throw new LlmOutputError('max_tokens', `${task}: output hit the token limit`);
  }
  const value = validate(prompt, task, response);
  if (value instanceof LlmOutputError) {
    await log('invalid', response);
    if (!escalated && route.escalate) throw new EscalationNeeded(value);
    throw value;
  }
  const confidence = confidenceOf(value);
  const threshold = route.escalate?.confidenceBelow;
  if (!escalated && threshold !== undefined && confidence !== null && confidence < threshold) {
    await log('low_confidence', response);
    throw new EscalationNeeded(null);
  }
  const costUsd = await log('ok', response);
  await db
    .insert(aiRequests)
    .values({
      key,
      townId: town.id,
      task,
      job,
      provider: providerName,
      model,
      status: 'succeeded',
      response,
      createdAt: now,
      completedAt: now,
    })
    .onConflictDoNothing();
  return { value, model: response.model, usage: response.usage, costUsd, escalated, reused: false };
}

function validate<T>(prompt: Prompt<T>, task: AiTask, response: LlmResponse): T | LlmOutputError {
  let parsed: z.ZodSafeParseResult<T>;
  try {
    parsed = prompt.schema.safeParse(JSON.parse(response.text));
  } catch {
    return new LlmOutputError('invalid', `${task}: output was not JSON`);
  }
  if (!parsed.success) {
    return new LlmOutputError(
      'invalid',
      `${task}: output failed its schema:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
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

/** How many queued requests one batch carries, at most. */
const BATCH_SIZE = 500;
/**
 * Finished requests are kept this long: long enough that a retried job never pays twice, short
 * enough that stored answers don't pile up (tens of thousands a day across the network).
 */
export const AI_REQUEST_RETENTION_DAYS = 14;

/**
 * The worker's batch job: submits queued batch requests (one batch per run), and collects every
 * ended batch, logging each answer's usage at the batch price. Callers pick the answers up on
 * their next run, by the same request key.
 */
export async function runAiBatches(
  llm: Pick<Llm, 'db' | 'provider' | 'providerName' | 'now'>,
): Promise<{ submitted: number; collected: number; failed: number }> {
  const { db, provider, providerName } = llm;
  const now = llm.now?.() ?? new Date();
  const out = { submitted: 0, collected: 0, failed: 0 };
  await db
    .delete(aiRequests)
    .where(
      and(
        inArray(aiRequests.status, ['succeeded', 'failed']),
        lt(aiRequests.createdAt, new Date(now.getTime() - AI_REQUEST_RETENTION_DAYS * 86_400_000)),
      ),
    );
  if (!provider.batch) return out;

  // Collect first, so a finished batch frees its reserved spend before new ones go out.
  const open = await db
    .selectDistinct({ batchId: aiRequests.batchId })
    .from(aiRequests)
    .where(and(eq(aiRequests.status, 'submitted'), eq(aiRequests.provider, providerName)));
  for (const { batchId } of open) {
    if (!batchId) continue;
    const polled = await provider.batch.poll(batchId);
    if (!polled.ended) continue;
    const rows = await db.select().from(aiRequests).where(eq(aiRequests.batchId, batchId));
    for (const row of rows) {
      if (row.status !== 'submitted') continue;
      const meta = row.request as { promptVersion: string; escalated: boolean };
      const result = polled.results.get(row.id) ?? { error: 'missing from the batch results' };
      const response = 'response' in result ? result.response : undefined;
      const ok = response && response.stop === 'end';
      const cost = response
        ? estimateCostUsd(priceKey(response.model, row.model), response.usage, { batch: true })
        : 0;
      await db.insert(aiUsage).values({
        townId: row.townId,
        job: row.job,
        task: row.task,
        model: response?.model ?? row.model,
        provider: providerName,
        promptVersion: meta.promptVersion,
        inputTokens: response?.usage.inputTokens ?? 0,
        outputTokens: response?.usage.outputTokens ?? 0,
        cacheReadTokens: response?.usage.cacheReadTokens ?? 0,
        cacheWriteTokens: response?.usage.cacheWriteTokens ?? 0,
        estCostUsd: cost.toFixed(6),
        outcome: ok
          ? 'ok'
          : response?.stop === 'refusal'
            ? 'refused'
            : response
              ? 'invalid'
              : 'error',
        escalated: meta.escalated,
        batch: true,
        createdAt: now,
      });
      await db
        .update(aiRequests)
        .set(
          ok
            ? { status: 'succeeded', response, completedAt: now }
            : {
                status: 'failed',
                error: 'error' in result ? result.error : `stopped: ${response?.stop}`,
                completedAt: now,
              },
        )
        .where(eq(aiRequests.id, row.id));
      if (ok) out.collected++;
      else out.failed++;
    }
  }

  const queued = await db
    .select()
    .from(aiRequests)
    .where(and(eq(aiRequests.status, 'queued'), eq(aiRequests.provider, providerName)))
    .orderBy(aiRequests.createdAt)
    .limit(BATCH_SIZE);
  if (queued.length) {
    const batchId = await provider.batch.submit(
      queued.map((row) => ({
        customId: row.id,
        request: JSON.parse((row.request as { json: string }).json) as LlmRequest,
      })),
    );
    await db
      .update(aiRequests)
      .set({ status: 'submitted', batchId })
      .where(
        inArray(
          aiRequests.id,
          queued.map((row) => row.id),
        ),
      );
    out.submitted = queued.length;
  }
  return out;
}
