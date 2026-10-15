import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { loadEnv, loadTowns, providerModels } from '@towncore/config';
import { aiUsage, eq, getTownBySlug, syncTowns, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { classifyV1, factcheckV1, updateV1, writerV1 } from '@towncore/prompts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  callModel,
  LlmOutputError,
  portableSchema,
  recordingProvider,
  replayProvider,
  resolveProviderName,
  SpendCapReached,
  type Llm,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type LlmTown,
  type Prompt,
} from '../src/llm';
import { anthropicProvider } from '../src/llm/anthropic';
import { geminiProvider } from '../src/llm/gemini';

const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));

const testPrompt: Prompt<{ answer: string; score: number }> = {
  id: 'test',
  version: 'v1',
  role: 'writer',
  effort: 'low',
  maxOutputTokens: 100,
  system: 'Answer in JSON.',
  schema: z.strictObject({ answer: z.string(), score: z.number().min(0).max(1) }),
};

/** A provider whose next answer is set per test; it remembers the last request. */
function fakeProvider() {
  let next: LlmResponse = ok('{"answer":"yes","score":0.5}');
  const state: { last?: LlmRequest } = {};
  const provider: LlmProvider = {
    name: 'replay',
    async generate(request) {
      state.last = request;
      return next;
    },
  };
  return { provider, state, answer: (response: LlmResponse) => (next = response) };
}

function ok(text: string, stop: LlmResponse['stop'] = 'end'): LlmResponse {
  return {
    text,
    stop,
    model: 'claude-sonnet-5-5',
    usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000 },
  };
}

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
});

const usageRows = () => db.select().from(aiUsage).where(eq(aiUsage.townId, town.id));

describe('callModel', () => {
  it('returns the validated answer and logs usage with cost', async () => {
    const fake = fakeProvider();
    const llm: Llm = { db, provider: fake.provider, providerName: 'anthropic' };
    const result = await callModel(llm, { job: 'test', town, prompt: testPrompt, input: 'Q' });

    expect(result.value).toEqual({ answer: 'yes', score: 0.5 });
    // Sonnet 5.5: $2/M in, $10/M out, $0.20/M cache read.
    expect(result.costUsd).toBeCloseTo((1000 * 2 + 500 * 10 + 2000 * 0.2) / 1e6, 8);
    expect(fake.state.last).toMatchObject({
      model: providerModels.anthropic.writer,
      system: 'Answer in JSON.',
      input: 'Q',
      effort: 'low',
    });
    const [row] = await usageRows();
    expect(row).toMatchObject({
      job: 'test',
      provider: 'anthropic',
      promptVersion: 'test@v1',
      outcome: 'ok',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 2000,
      estCostUsd: '0.007400',
    });
  });

  it('picks the model for the configured provider', async () => {
    const fake = fakeProvider();
    fake.answer({ ...ok('{"answer":"a","score":1}'), model: 'gemini-3.6-flash' });
    await callModel(
      { db, provider: fake.provider, providerName: 'gemini' },
      { job: 'test', town, prompt: testPrompt, input: 'Q' },
    );
    expect(fake.state.last?.model).toBe(providerModels.gemini.writer);
    // The dated model has no price of its own, so it's priced as the configured alias ($0).
    const [row] = await usageRows();
    expect(row).toMatchObject({ model: 'gemini-3.6-flash', estCostUsd: '0.000000' });
  });

  it('rejects output that fails the schema, and still logs the call', async () => {
    const fake = fakeProvider();
    fake.answer(ok('{"answer":"yes","score":7}'));
    const llm: Llm = { db, provider: fake.provider, providerName: 'anthropic' };
    await expect(
      callModel(llm, { job: 'test', town, prompt: testPrompt, input: 'Q' }),
    ).rejects.toMatchObject({ kind: 'invalid' });
    fake.answer(ok('not json'));
    await expect(
      callModel(llm, { job: 'test', town, prompt: testPrompt, input: 'Q' }),
    ).rejects.toBeInstanceOf(LlmOutputError);
    expect((await usageRows()).map((r) => r.outcome)).toEqual(['invalid', 'invalid']);
  });

  it('turns a refusal into an error for human review, never an answer', async () => {
    const fake = fakeProvider();
    fake.answer(ok('', 'refusal'));
    await expect(
      callModel(
        { db, provider: fake.provider, providerName: 'anthropic' },
        { job: 'test', town, prompt: testPrompt, input: 'Q' },
      ),
    ).rejects.toMatchObject({ kind: 'refusal' });
    expect((await usageRows())[0]?.outcome).toBe('refused');
  });

  it('logs provider errors before rethrowing', async () => {
    const provider: LlmProvider = {
      name: 'replay',
      generate: async () => {
        throw new Error('HTTP 503');
      },
    };
    await expect(
      callModel(
        { db, provider, providerName: 'anthropic' },
        { job: 'test', town, prompt: testPrompt, input: 'Q' },
      ),
    ).rejects.toThrow('HTTP 503');
    expect((await usageRows())[0]).toMatchObject({ outcome: 'error', inputTokens: 0 });
  });

  it('stops at the daily spend cap, counted from midnight in the town timezone', async () => {
    const fake = fakeProvider();
    // 9:30 pm Oct 15 in Boca = 01:30 UTC Oct 16.
    const now = new Date('2026-10-16T01:30:00Z');
    const llm: Llm = { db, provider: fake.provider, providerName: 'anthropic', now: () => now };
    const row = (createdAt: string, cost: string) => ({
      townId: town.id,
      job: 'test',
      model: 'claude-sonnet-5-5',
      inputTokens: 0,
      outputTokens: 0,
      estCostUsd: cost,
      createdAt: new Date(createdAt),
    });
    // Yesterday in Boca (before 04:00 UTC Oct 15): doesn't count.
    await db.insert(aiUsage).values(row('2026-10-15T03:59:00Z', '100'));
    await expect(
      callModel(llm, { job: 'test', town, prompt: testPrompt, input: 'Q' }),
    ).resolves.toBeDefined();

    // Earlier today in Boca: $4.99 + the call above, still under $5.
    await db.insert(aiUsage).values(row('2026-10-15T12:00:00Z', '4.99'));
    await expect(
      callModel(llm, { job: 'test', town, prompt: testPrompt, input: 'Q' }),
    ).resolves.toBeDefined();
    await expect(
      callModel(llm, { job: 'test', town, prompt: testPrompt, input: 'Q' }),
    ).rejects.toBeInstanceOf(SpendCapReached);
  });

  it('stops at the daily call cap (free-tier quota guard)', async () => {
    const fake = fakeProvider();
    const llm: Llm = { db, provider: fake.provider, providerName: 'gemini' };
    const capped = { ...town, aiDailyCallCap: 2 };
    await callModel(llm, { job: 'test', town: capped, prompt: testPrompt, input: 'Q' });
    await callModel(llm, { job: 'test', town: capped, prompt: testPrompt, input: 'Q' });
    await expect(
      callModel(llm, { job: 'test', town: capped, prompt: testPrompt, input: 'Q' }),
    ).rejects.toThrow(/2 of 2 calls/);
  });
});

describe('portableSchema', () => {
  it('closes objects and drops $schema and value constraints', () => {
    const json = portableSchema(testPrompt.schema);
    expect(json).toEqual({
      type: 'object',
      properties: { answer: { type: 'string' }, score: { type: 'number' } },
      required: ['answer', 'score'],
      additionalProperties: false,
    });
  });

  it('works for every v1 prompt, and they all fit the Prompt contract', () => {
    const prompts: Prompt<unknown>[] = [classifyV1, writerV1, factcheckV1, updateV1];
    for (const prompt of prompts) {
      const text = JSON.stringify(portableSchema(prompt.schema));
      expect(text).not.toMatch(/"(\$schema|minimum|maximum|minLength|maxLength|minItems)"/);
      expect(text).not.toMatch(/"additionalProperties":true/);
    }
  });
});

describe('providers', () => {
  const request: LlmRequest = {
    model: 'm',
    system: 'S',
    input: 'I',
    schema: { type: 'object' },
    effort: 'medium',
    maxOutputTokens: 50,
  };

  it('gemini: sends an Interactions request and reads the last model output', async () => {
    let sent: { url: string; init: RequestInit } | undefined;
    const provider = geminiProvider('k', async (url, init) => {
      sent = { url, init };
      return Response.json({
        model: 'gemini-3.6-flash',
        status: 'completed',
        steps: [
          { type: 'thought', content: [] },
          {
            type: 'model_output',
            content: [
              { type: 'text', text: '{"a":' },
              { type: 'text', text: '1}' },
            ],
          },
        ],
        usage: {
          total_input_tokens: 10,
          total_output_tokens: 5,
          total_thought_tokens: 7,
          total_cached_tokens: 0,
        },
      });
    });
    const response = await provider.generate(request);
    expect(sent?.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect((sent?.init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
    expect(JSON.parse(String(sent?.init.body))).toEqual({
      model: 'm',
      store: false,
      system_instruction: 'S',
      input: 'I',
      response_format: { type: 'text', mime_type: 'application/json', schema: { type: 'object' } },
      generation_config: { max_output_tokens: 50, thinking_level: 'medium' },
    });
    expect(response).toEqual({
      text: '{"a":1}',
      stop: 'end',
      model: 'gemini-3.6-flash',
      usage: { inputTokens: 10, outputTokens: 12, cacheReadTokens: 0 },
    });
  });

  it('gemini: reports incomplete as max_tokens and HTTP errors as errors', async () => {
    const incomplete = geminiProvider('k', async () =>
      Response.json({ status: 'incomplete', steps: [] }),
    );
    expect((await incomplete.generate(request)).stop).toBe('max_tokens');
    const failing = geminiProvider('k', async () =>
      Response.json({ error: { message: 'quota' } }, { status: 429 }),
    );
    await expect(failing.generate(request)).rejects.toThrow('Gemini HTTP 429: quota');
  });

  it('anthropic: sends structured-output params and maps usage and stop reasons', async () => {
    let body: Record<string, unknown> = {};
    const client = new Anthropic({
      apiKey: 'test',
      maxRetries: 0,
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-5-5',
          content: [{ type: 'text', text: '{"a":1}' }],
          stop_reason: 'refusal',
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_creation_input_tokens: 3,
            cache_read_input_tokens: 20,
          },
        });
      },
    });
    const response = await anthropicProvider(client).generate(request);
    expect(body).toMatchObject({
      model: 'm',
      max_tokens: 50,
      system: [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'I' }],
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: { type: 'object' } },
      },
    });
    expect(response).toEqual({
      text: '{"a":1}',
      stop: 'refusal',
      model: 'claude-sonnet-5-5',
      usage: { inputTokens: 13, outputTokens: 5, cacheReadTokens: 20 },
    });
  });

  it('records responses and replays them without a model', async () => {
    const fake = fakeProvider();
    const recorder = recordingProvider(fake.provider);
    const response = await recorder.provider.generate(request);
    const path = fileURLToPath(new URL('../.tmp/llm-fixture.json', import.meta.url));
    recorder.save(path);
    const replay = replayProvider(path);
    await expect(replay.generate({ ...request, model: 'other' })).resolves.toEqual(response);
    await expect(replay.generate({ ...request, input: 'changed' })).rejects.toThrow(/re-record/);
  });

  it('chooses the provider from the environment', () => {
    expect(resolveProviderName(loadEnv({ GEMINI_API_KEY: 'g' }))).toBe('gemini');
    expect(resolveProviderName(loadEnv({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' }))).toBe(
      'anthropic',
    );
    expect(
      resolveProviderName(
        loadEnv({ ANTHROPIC_API_KEY: 'a', LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'g' }),
      ),
    ).toBe('gemini');
    expect(resolveProviderName(loadEnv({}))).toBeUndefined();
  });
});
