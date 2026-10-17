import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import {
  aiTasks,
  estimateCostUsd,
  loadTowns,
  providerModels,
  taskRoutes,
  worstCaseCostUsd,
  type AiTask,
} from '@towncore/config';
import { aiRequests, aiUsage, eq, getTownBySlug, syncTowns, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { classifyPrompt } from '@towncore/prompts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BatchPending,
  callModel,
  LlmOutputError,
  runAiBatches,
  SpendCapReached,
  TaskDisabled,
  type BatchApi,
  type Llm,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type LlmTown,
  type Prompt,
} from '../src/llm';
import { anthropicProvider } from '../src/llm/anthropic';
import { classification } from './helpers';

// The Claude model protocol (owner, 2026-10-17): every call names a task; the routing table picks
// the model and its settings; escalation fires only on invalid output or low confidence; caps
// stop work and never fall through to a bigger model; batch tasks wait for the worker; an
// identical request is never sent twice. All with no API key: fake providers and fake fetches.

const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));
const NOW = new Date('2026-10-17T15:00:00Z');

let db: Db;
let drop: () => Promise<void>;
let town: LlmTown;

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  const loaded = loadTowns(townsDir).filter((t) => t.config.slug === 'boca-raton');
  await syncTowns(
    db,
    loaded.map((t) => ({ ...t, config: { ...t.config, sources: [] } })),
  );
  const boca = (await getTownBySlug(db, 'boca-raton'))!;
  town = { id: boca.id, timezone: boca.timezone, aiDailyCapUsd: 5, aiDailyCallCap: 400 };
});
afterAll(async () => drop());
beforeEach(async () => {
  await db.delete(aiUsage);
  await db.delete(aiRequests);
});

const usage = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0 };
const answer = (value: unknown, model = 'claude-haiku-5-5'): LlmResponse => ({
  text: JSON.stringify(value),
  stop: 'end',
  model,
  usage,
});

/** A provider answering from a list (the last answer repeats); remembers every request. */
function fake(answers: LlmResponse[], extra: Partial<LlmProvider> = {}) {
  const requests: LlmRequest[] = [];
  const queue = [...answers];
  const provider: LlmProvider = {
    name: 'replay',
    webSearch: true,
    images: true,
    ...extra,
    async generate(request) {
      requests.push(request);
      return (queue.length > 1 ? queue.shift() : queue[0])!;
    },
  };
  const llm: Llm = { db, provider, providerName: 'anthropic', now: () => NOW };
  return { llm, requests };
}

const simple = (task: AiTask): Prompt<{ ok: boolean }> => ({
  id: `t-${task}`,
  version: 'v1',
  task,
  system: 'Answer in JSON.',
  schema: z.strictObject({ ok: z.boolean() }),
});
const rows = () => db.select().from(aiUsage).orderBy(aiUsage.createdAt);

describe('routing', () => {
  it('sends every task to its configured model with its own settings', async () => {
    for (const task of aiTasks) {
      const route = taskRoutes[task];
      const { llm, requests } = fake([answer({ ok: true })]);
      if (route.disabled) {
        await expect(
          callModel(llm, { job: 't', town, prompt: simple(task), input: task }),
        ).rejects.toBeInstanceOf(TaskDisabled);
        expect(requests).toHaveLength(0);
        continue;
      }
      // Batch tasks run directly when the provider has no batch support.
      await callModel(llm, { job: 't', town, prompt: simple(task), input: task });
      expect(requests[0], task).toMatchObject({
        model: providerModels.anthropic[route.tier],
        effort: route.effort,
        thinking: route.thinking,
        maxOutputTokens: route.maxOutputTokens,
      });
      expect(requests[0]!.webSearch, task).toEqual(route.webSearch);
    }
    const logged = await rows();
    expect(new Set(logged.map((r) => r.task))).toEqual(
      new Set(aiTasks.filter((t) => !taskRoutes[t].disabled)),
    );
  });

  it('uses the cheapest size that fits: Haiku to classify and extract, Sonnet to write and check, Opus to discover', () => {
    const tier = (task: AiTask) => providerModels.anthropic[taskRoutes[task].tier];
    expect([tier('classify'), tier('extract')]).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5']);
    for (const task of ['write', 'factcheck', 'revise', 'guide', 'guide-factcheck'] as const)
      expect(tier(task)).toBe('claude-sonnet-5-5');
    expect(tier('discover')).toBe('claude-opus-5-5');
    expect(taskRoutes.guide.batch && taskRoutes['guide-factcheck'].batch).toBe(true);
    expect(taskRoutes.reviewer.disabled).toBe(true);
  });

  it("uses Claude's classify variant, which reports confidence; Gemini keeps v1", async () => {
    const claude = fake([answer({ ...classification(), confidence: 0.9 })]);
    const r = await callModel(claude.llm, {
      job: 'classify',
      town,
      prompt: classifyPrompt,
      input: 'records',
    });
    expect(claude.requests[0]!.system).toContain('confidence (0–1)');
    expect(r.value).toMatchObject({ confidence: 0.9 });
    const gemini = fake([answer(classification(), 'gemini-flash-lite-latest')]);
    await callModel(
      { ...gemini.llm, providerName: 'gemini' },
      { job: 'classify', town, prompt: classifyPrompt, input: 'records' },
    );
    expect(gemini.requests[0]!.system).not.toContain('confidence (0–1)');
  });
});

describe('escalation', () => {
  it('retries once on Sonnet when Haiku reports low confidence, and logs both calls', async () => {
    const { llm, requests } = fake([
      answer({ ...classification(), confidence: 0.3 }),
      answer({ ...classification(), confidence: 0.8 }, 'claude-sonnet-5-5'),
    ]);
    const r = await callModel(llm, { job: 'c', town, prompt: classifyPrompt, input: 'x' });
    expect(requests.map((q) => q.model)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
    expect(r).toMatchObject({ escalated: true, model: 'claude-sonnet-5-5' });
    expect((await rows()).map((x) => [x.outcome, x.escalated])).toEqual([
      ['low_confidence', false],
      ['ok', true],
    ]);
  });

  it('retries once on Sonnet when Haiku returns invalid output', async () => {
    const { llm, requests } = fake([
      { ...answer({}), text: 'not json' },
      answer({ ...classification(), confidence: 0.8 }, 'claude-sonnet-5-5'),
    ]);
    await callModel(llm, { job: 'c', town, prompt: classifyPrompt, input: 'x' });
    expect(requests.map((q) => q.model)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
  });

  it('does not escalate a confident answer, a refusal, or a task without escalation', async () => {
    const sure = fake([answer({ ...classification(), confidence: 0.95 })]);
    await callModel(sure.llm, { job: 'c', town, prompt: classifyPrompt, input: 'x' });
    expect(sure.requests).toHaveLength(1);

    const refused = fake([{ ...answer({}), stop: 'refusal' }]);
    await expect(
      callModel(refused.llm, { job: 'c', town, prompt: classifyPrompt, input: 'y' }),
    ).rejects.toMatchObject({ kind: 'refusal' });
    expect(refused.requests).toHaveLength(1);

    const writer = fake([{ ...answer({}), text: 'not json' }]);
    await expect(
      callModel(writer.llm, { job: 'w', town, prompt: simple('write'), input: 'z' }),
    ).rejects.toBeInstanceOf(LlmOutputError);
    expect(writer.requests).toHaveLength(1);
  });

  it('never escalates past a cap: the work stops instead', async () => {
    // The classify task's day is nearly spent: Haiku fits, the Sonnet retry does not.
    await db.insert(aiUsage).values({
      townId: town.id,
      job: 'c',
      task: 'classify',
      model: 'claude-haiku-5-5',
      inputTokens: 0,
      outputTokens: 0,
      estCostUsd: (taskRoutes.classify.dailyCapUsd - 0.005).toFixed(6),
      createdAt: NOW,
    });
    const { llm, requests } = fake([answer({ ...classification(), confidence: 0.2 })]);
    await expect(
      callModel(llm, { job: 'c', town, prompt: classifyPrompt, input: 'x' }),
    ).rejects.toBeInstanceOf(SpendCapReached);
    expect(requests.map((q) => q.model)).toEqual(['claude-haiku-5-5']);
  });
});

describe('caps', () => {
  it("refuses a call whose worst case is over the task's per-call limit, before sending it", async () => {
    const { llm, requests } = fake([answer({ ok: true })]);
    const tight: Llm = { ...llm, routeOverrides: { write: { maxCallUsd: 0.01 } } };
    await expect(
      callModel(tight, { job: 'w', town, prompt: simple('write'), input: 'x' }),
    ).rejects.toThrow(/over its \$0.01 limit/);
    expect(requests).toHaveLength(0);
  });

  it("stops a task at its network-wide daily cap, whatever the town's own room", async () => {
    await db.insert(aiUsage).values({
      townId: null,
      job: 'w',
      task: 'write',
      model: 'claude-sonnet-5-5',
      inputTokens: 0,
      outputTokens: 0,
      estCostUsd: String(taskRoutes.write.dailyCapUsd),
      createdAt: NOW,
    });
    const { llm, requests } = fake([answer({ ok: true })]);
    await expect(
      callModel(llm, { job: 'w', town, prompt: simple('write'), input: 'x' }),
    ).rejects.toThrow(/write: \$20.00 of its \$20 today/);
    // Another task still runs.
    await callModel(llm, { job: 'c', town, prompt: simple('factcheck'), input: 'x' });
    expect(requests).toHaveLength(1);
  });
});

describe('costs', () => {
  it('prices a known token count: input, output, cache reads, cache writes and the batch discount', () => {
    const million = {
      inputTokens: 1e6,
      outputTokens: 1e6,
      cacheReadTokens: 1e6,
      cacheWriteTokens: 1e6,
    };
    // Sonnet 5.5: $2 in, $10 out, $0.20 cache read, $2.50 cache write (1.25x).
    expect(estimateCostUsd('claude-sonnet-5-5', million)).toBeCloseTo(14.7, 8);
    expect(estimateCostUsd('claude-sonnet-5-5', million, { batch: true })).toBeCloseTo(7.35, 8);
    // Haiku 5.5: $0.10 in, $0.50 out.
    expect(
      estimateCostUsd('claude-haiku-5-5', {
        inputTokens: 3000,
        outputTokens: 1000,
        cacheReadTokens: 0,
      }),
    ).toBeCloseTo(0.0008, 10);
  });

  it('estimates the worst case before a call: every char as a token third, the full output limit, every search', () => {
    // 3,000 chars = 1,000 tokens; 6,000 output tokens on Sonnet: $0.002 + $0.06.
    expect(worstCaseCostUsd('claude-sonnet-5-5', taskRoutes.write, { chars: 3000 })).toBeCloseTo(
      0.062,
      8,
    );
    // Discovery on Opus: 12 searches at $0.01 plus up to 6,000 tokens each of results.
    const d = taskRoutes.discover;
    expect(worstCaseCostUsd('claude-opus-5-5', d, { chars: 300 })).toBeCloseTo(
      (100 + 12 * 6000) * 4e-6 + d.maxOutputTokens * 20e-6 + 0.12,
      8,
    );
    // Every task's worst case on a typical input fits under its own per-call limit.
    for (const task of aiTasks) {
      const route = taskRoutes[task];
      const model = providerModels.anthropic[route.tier];
      expect(worstCaseCostUsd(model, route, { chars: 12_000 }), task).toBeLessThanOrEqual(
        route.maxCallUsd,
      );
    }
  });
});

describe('idempotency', () => {
  it('never sends the same request twice: the stored answer comes back at no cost', async () => {
    const { llm, requests } = fake([answer({ ok: true }, 'claude-sonnet-5-5')]);
    const first = await callModel(llm, { job: 'w', town, prompt: simple('write'), input: 'same' });
    const again = await callModel(llm, { job: 'w', town, prompt: simple('write'), input: 'same' });
    expect(requests).toHaveLength(1);
    expect(first.reused).toBe(false);
    expect(again).toMatchObject({ reused: true, costUsd: 0, value: { ok: true } });
    expect(await rows()).toHaveLength(1);
  });

  it('sends a request again after a failure (nothing was stored)', async () => {
    let fail = true;
    const provider: LlmProvider = {
      name: 'replay',
      async generate() {
        if (fail) {
          fail = false;
          throw new Error('HTTP 529 overloaded');
        }
        return answer({ ok: true }, 'claude-sonnet-5-5');
      },
    };
    const llm: Llm = { db, provider, providerName: 'anthropic', now: () => NOW };
    await expect(
      callModel(llm, { job: 'w', town, prompt: simple('write'), input: 'q' }),
    ).rejects.toThrow('529');
    await expect(
      callModel(llm, { job: 'w', town, prompt: simple('write'), input: 'q' }),
    ).resolves.toMatchObject({ value: { ok: true } });
  });
});

describe('batches', () => {
  it('queues a batch task, submits it, collects it at half price and hands it back', async () => {
    const submitted: Array<{ customId: string; request: LlmRequest }> = [];
    let ended = false;
    const batch: BatchApi = {
      async submit(items) {
        submitted.push(...items);
        return 'msgbatch_1';
      },
      async poll() {
        if (!ended) return { ended: false };
        return {
          ended: true,
          results: new Map(
            submitted.map((s) => [
              s.customId,
              { response: answer({ ok: true }, 'claude-sonnet-5-5') },
            ]),
          ),
        };
      },
    };
    const { llm, requests } = fake([answer({ ok: false })], { batch });
    const call = () =>
      callModel(llm, { job: 'guide', town, prompt: simple('guide'), input: 'pages' });

    await expect(call()).rejects.toBeInstanceOf(BatchPending);
    await expect(call()).rejects.toBeInstanceOf(BatchPending); // queued once, not twice
    expect(await runAiBatches(llm)).toEqual({ submitted: 1, collected: 0, failed: 0 });
    expect(submitted[0]!.request).toMatchObject({ model: 'claude-sonnet-5-5', input: 'pages' });
    await expect(call()).rejects.toBeInstanceOf(BatchPending);
    expect(await runAiBatches(llm)).toEqual({ submitted: 0, collected: 0, failed: 0 });

    ended = true;
    expect(await runAiBatches(llm)).toEqual({ submitted: 0, collected: 1, failed: 0 });
    const result = await call();
    expect(result).toMatchObject({ value: { ok: true }, reused: true });
    expect(requests).toHaveLength(0); // never a direct call
    const [row] = await rows();
    expect(row).toMatchObject({ task: 'guide', batch: true, outcome: 'ok' });
    // Half of Sonnet's $0.002 + $0.002.
    expect(Number(row!.estCostUsd)).toBeCloseTo(0.002, 6);
  });

  it("counts queued batch work against the caps before it's billed", async () => {
    const batch: BatchApi = { submit: async () => 'b', poll: async () => ({ ended: false }) };
    const { llm } = fake([answer({ ok: true })], { batch });
    const small = { ...town, aiDailyCapUsd: 0.5 };
    // Each guide's worst case (8,000 output tokens on Sonnet, at the batch price) is reserved
    // while it waits, so the town's $0.50 holds only so many.
    const each = worstCaseCostUsd('claude-sonnet-5-5', taskRoutes.guide, {
      chars: 'Answer in JSON.'.length + 3,
    });
    const fits = Math.floor(0.5 / each);
    expect(fits).toBe(12);
    for (let i = 0; i < fits; i++) {
      await expect(
        callModel(llm, { job: 'g', town: small, prompt: simple('guide'), input: `p${i}` }),
      ).rejects.toBeInstanceOf(BatchPending);
    }
    await expect(
      callModel(llm, { job: 'g', town: small, prompt: simple('guide'), input: 'p99' }),
    ).rejects.toBeInstanceOf(SpendCapReached);
    expect(await db.select().from(aiRequests).where(eq(aiRequests.status, 'queued'))).toHaveLength(
      fits,
    );
  });
});

describe('anthropic request shape', () => {
  function capture() {
    const bodies: Array<Record<string, unknown>> = [];
    const client = new Anthropic({
      apiKey: 'test',
      maxRetries: 0,
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-5-5',
          content: [{ type: 'text', text: '{}' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      },
    });
    return { provider: anthropicProvider(client), bodies };
  }
  const base: LlmRequest = {
    model: 'claude-haiku-5-5',
    system: 'S',
    inputPrefix: 'Town: Boca Raton, FL',
    input: 'records',
    schema: { type: 'object' },
    effort: 'low',
    thinking: 'off',
    maxOutputTokens: 100,
  };

  it('turns thinking off the way each model allows', async () => {
    const { provider, bodies } = capture();
    await provider.generate(base);
    await provider.generate({ ...base, model: 'claude-sonnet-5-5' });
    await provider.generate({ ...base, model: 'claude-opus-5-5' });
    await provider.generate({ ...base, model: 'claude-sonnet-5-5', thinking: 'adaptive' });
    expect(bodies.map((b) => b.thinking)).toEqual([
      { type: 'disabled' },
      { type: 'between_tools' },
      undefined, // Opus 5.5 can't turn it off: effort is the control
      undefined, // adaptive is the default
    ]);
  });

  it('caches the system prompt and the town prefix, then sends the per-call input', async () => {
    const { provider, bodies } = capture();
    await provider.generate(base);
    expect(bodies[0]).toMatchObject({
      system: [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Town: Boca Raton, FL', cache_control: { type: 'ephemeral' } },
            { type: 'text', text: 'records' },
          ],
        },
      ],
      max_tokens: 100,
      output_config: { effort: 'low' },
    });
  });

  it('submits a batch with each request under its custom ID', async () => {
    let body: Record<string, unknown> = {};
    const client = new Anthropic({
      apiKey: 'test',
      maxRetries: 0,
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({
          id: 'msgbatch_9',
          type: 'message_batch',
          processing_status: 'in_progress',
          request_counts: { processing: 1, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
          created_at: NOW.toISOString(),
          expires_at: NOW.toISOString(),
          ended_at: null,
          archived_at: null,
          cancel_initiated_at: null,
          results_url: null,
        });
      },
    });
    const id = await anthropicProvider(client).batch!.submit([{ customId: 'r1', request: base }]);
    expect(id).toBe('msgbatch_9');
    expect(body).toMatchObject({
      requests: [
        { custom_id: 'r1', params: { model: 'claude-haiku-5-5', thinking: { type: 'disabled' } } },
      ],
    });
  });
});

describe('reporting', () => {
  it('shows spend by task and model with cost per story and the cache hit rate', async () => {
    const { aiSpend } = await import('../src/ops');
    await db.insert(aiUsage).values([
      {
        townId: town.id,
        job: 'c',
        task: 'classify',
        model: 'claude-haiku-5-5',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 900,
        estCostUsd: '0.001000',
        createdAt: NOW,
      },
      {
        townId: town.id,
        job: 'w',
        task: 'write',
        model: 'claude-sonnet-5-5',
        inputTokens: 500,
        outputTokens: 900,
        cacheReadTokens: 500,
        escalated: true,
        estCostUsd: '0.020000',
        createdAt: NOW,
      },
    ]);
    const spend = await aiSpend(db, new Date(NOW.getTime() + 1000));
    expect(spend.usd).toBeCloseTo(0.021, 6);
    expect(spend.cacheHitRate).toBeCloseTo(1400 / 2000, 6);
    expect(spend.rows.map((r) => [r.task, r.model, r.escalations])).toEqual([
      ['write', 'claude-sonnet-5-5', 1],
      ['classify', 'claude-haiku-5-5', 0],
    ]);
  });

  it('plans a day of work with no key: tasks, models, calls and cost', async () => {
    const { planDay, formatPlan } = await import('../src/ai-plan');
    const plan = await planDay(db, 'boca-raton', { now: NOW });
    // No records yet: nothing to classify or write; Boca's 30 guide topics refresh in batches.
    expect(plan.lines.map((l) => l.task)).toEqual(['guide', 'guide-factcheck', 'guide-revise']);
    expect(plan.lines.every((l) => l.batch && l.model === 'claude-sonnet-5-5')).toBe(true);
    expect(plan.launch.map((l) => [l.task, l.model])).toEqual([
      ['discover', 'claude-opus-5-5'],
      ['identity', 'claude-opus-5-5'],
      ['theme-review', 'claude-opus-5-5'],
    ]);
    expect(plan.launchUsd).toBeLessThan(25);
    expect(formatPlan(plan)).toMatch(/no model is called/);
  });
});

describe('alerts and eval comparisons', () => {
  it('raises an alert when a task reaches its daily cap', async () => {
    const { opsConditions } = await import('../src/ops');
    await db.insert(aiUsage).values({
      townId: town.id,
      job: 'w',
      task: 'write',
      model: 'claude-sonnet-5-5',
      inputTokens: 0,
      outputTokens: 0,
      estCostUsd: String(taskRoutes.write.dailyCapUsd),
      createdAt: NOW,
    });
    const conditions = await opsConditions(db, new Date(NOW.getTime() + 1000));
    expect(conditions.map((c) => c.key)).toContain('task_cap:write');
  });

  it('lines up route variants by quality first, then cost', async () => {
    const { compareVariants } = await import('../src/evals');
    const summary = (passRate: number, safety = 0) => ({
      cases: 10,
      passed: 10 - safety,
      safetyFailures: safety,
      factcheckPassRate: passRate,
      verbatimQuoteRate: 1,
      results: [],
    });
    const lines = compareVariants([
      {
        variant: 'baseline',
        provider: 'anthropic',
        ranAt: '',
        summary: summary(0.8),
        costUsd: 0.2,
        calls: 30,
      },
      {
        variant: 'writer-thinking',
        provider: 'anthropic',
        ranAt: '',
        summary: summary(0.9),
        costUsd: 0.5,
        calls: 30,
      },
      {
        variant: 'classify-sonnet',
        provider: 'anthropic',
        ranAt: '',
        summary: summary(0.95, 1),
        costUsd: 0.3,
        calls: 30,
      },
    ]);
    expect(lines.map((l) => l.split(' ')[0])).toEqual([
      'writer-thinking',
      'baseline',
      'classify-sonnet', // a safety failure sinks it, whatever its pass rate
    ]);
  });
});

describe('retention', () => {
  it('prunes finished requests after two weeks, keeping recent answers and waiting batches', async () => {
    const old = new Date(NOW.getTime() - 15 * 86_400_000);
    const row = (key: string, status: string, createdAt: Date) => ({
      key,
      townId: town.id,
      task: 'write',
      job: 'w',
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      status,
      createdAt,
    });
    await db
      .insert(aiRequests)
      .values([
        row('old-done', 'succeeded', old),
        row('old-failed', 'failed', old),
        row('old-waiting', 'submitted', old),
        row('new-done', 'succeeded', NOW),
      ]);
    const { llm } = fake([answer({ ok: true })]);
    await runAiBatches(llm);
    const left = await db.select({ key: aiRequests.key }).from(aiRequests);
    expect(left.map((r) => r.key).sort()).toEqual(['new-done', 'old-waiting']);
  });
});
