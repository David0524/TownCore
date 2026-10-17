import { fileURLToPath } from 'node:url';
import { loadTowns } from '@towncore/config';
import { getTownBySlug, syncTowns, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { classifyV1, factcheckV1, writerV1 } from '@towncore/prompts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEvalCases, runEvals, stableUuid } from '../src/evals';
import type { Llm, LlmProvider } from '../src/llm';
import { classification } from './helpers';

const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));
const casesPath = fileURLToPath(new URL('../../prompts/evals/cases.json', import.meta.url));
const NOW = new Date('2026-10-15T16:00:00Z');

let db: Db;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  const loaded = loadTowns(townsDir).filter((t) => t.config.slug === 'boca-raton');
  await syncTowns(
    db,
    loaded.map((t) => ({ ...t, config: { ...t.config, sources: [] } })),
  );
});
afterAll(async () => drop());

/** A naive model: always proposes Tier 1 and writes the record's first sentence verbatim. */
function naiveModel(): Llm {
  const provider: LlmProvider = {
    name: 'replay',
    async generate(request) {
      const id = request.input.match(/--- Record ([0-9a-f-]{36})/)![1]!;
      const body = request.input.split(/--- Record [^\n]*\nTitle: [^\n]*\n/)[1] ?? '';
      const first = body.split(/(?<=\.)\s/)[0]!.trim();
      let value: unknown;
      if (request.system === classifyV1.system) {
        value = classification({ proposed_tier: 1, impact: 0.5 });
      } else if (request.system === writerV1.system) {
        value = {
          headline: 'A plain factual headline here',
          dek: '',
          body_md: first,
          beat: 'government',
          source_record_ids: [id],
          claims: [],
        };
      } else if (request.system === factcheckV1.system) {
        value = {
          claims: [{ claim: 'first sentence', record_id: id, quote: first, supported: true }],
          wrong_town_risk: false,
          wrong_town_reason: null,
        };
      }
      return {
        text: JSON.stringify(value),
        stop: 'end',
        model: 'gemini-flash-latest',
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
      };
    },
  };
  return { db, provider, providerName: 'gemini', now: () => NOW };
}

describe('eval harness', () => {
  it('loads all 25 cases: 20 Boca seeds, Delray, Harbor Point and Pine Hollow', () => {
    const cases = loadEvalCases(casesPath, (_f, id) => ({ title: `Release ${id}`, text: 'x' }));
    expect(cases).toHaveLength(25);
    expect(new Set(cases.map((c) => c.town ?? 'boca-raton'))).toEqual(
      new Set(['boca-raton', 'delray-beach', 'harbor-point', 'pine-hollow']),
    );
    expect(stableUuid('a')).toBe(stableUuid('a'));
    expect(stableUuid('a')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('the code rules hold even against a model that under-tiers everything', async () => {
    const cases = loadEvalCases(casesPath, (_f, id) => ({
      title: `Release ${id}`,
      text: '',
    })).filter((c) =>
      [
        'synthetic-minor-named-age',
        'synthetic-adult-arrest-official-release',
        'synthetic-road-closure',
      ].includes(c.id),
    );
    const town = (await getTownBySlug(db, 'boca-raton'))!;
    const summary = await runEvals(db, town.id, cases, { llm: naiveModel(), now: NOW });
    const byId = Object.fromEntries(summary.results.map((r) => [r.id, r]));
    // The age in the text makes it Tier 4 whatever the model says (dropped before writing).
    expect(byId['synthetic-minor-named-age']).toMatchObject({ skip: 'tier4', failures: [] });
    // A police source is at least Tier 3: written, but held for review.
    expect(byId['synthetic-adult-arrest-official-release']).toMatchObject({
      tier: 3,
      status: 'in_review',
      failures: [],
    });
    expect(byId['synthetic-road-closure']).toMatchObject({ status: 'published', failures: [] });
    expect(summary).toMatchObject({ cases: 3, passed: 3, safetyFailures: 0, verbatimQuoteRate: 1 });
  });
});
