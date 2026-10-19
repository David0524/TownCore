import { fileURLToPath } from 'node:url';
import { loadTowns } from '@towncore/config';
import { getTownBySlug, syncTowns, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { Fetcher, legistarAdapter, replayFetch } from '@towncore/adapters';
import { classifyV1, factcheckV1, meetingSplitV1, writerV1 } from '@towncore/prompts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVAL_VARIANTS, loadEvalCases, runEvals, stableUuid } from '../src/evals';
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

/**
 * A naive model: always proposes Tier 1 and writes the record's first sentence verbatim. As the
 * splitter, it lists the record's lines that end in a decision, copied word for word.
 */
function naiveModel(routeOverrides?: Llm['routeOverrides']): Llm {
  const provider: LlmProvider = {
    name: 'replay',
    async generate(request) {
      const id = request.input.match(/--- Record ([0-9a-f-]{36})/)![1]!;
      const body = request.input.split(/--- Record [^\n]*\nTitle: [^\n]*\n/)[1] ?? '';
      const first = body.split(/(?<=\.)\s/)[0]!.trim();
      let value: unknown;
      if (request.system === meetingSplitV1.system) {
        const decided = body
          .split('\n')
          .filter((l) => /This Resolution was (approved|denied)\.$/.test(l))
          .slice(0, 3);
        value = {
          items: decided.map((line) => ({
            topic: line.slice(2, 60),
            agenda_number: null,
            outcome: line.endsWith('denied.') ? 'denied' : 'approved',
            vote_tally: null,
            record_ids: [id],
            minutes_excerpt: line.slice(2),
            transcript_window: null,
            newsworthy: true,
            impact: 0.7,
            novelty: 0.5,
            proximity: 0.5,
            reason: 'a resolution',
          })),
        };
      } else if (request.system === classifyV1.system) {
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
  return {
    db,
    provider,
    providerName: 'gemini',
    now: () => NOW,
    ...(routeOverrides ? { routeOverrides } : {}),
  };
}

describe('eval harness', () => {
  it('loads all 28 cases: Boca seeds and sensitive topics, Delray, Harbor Point and Pine Hollow', () => {
    const cases = loadEvalCases(casesPath, (_f, id) => ({ title: `Release ${id}`, text: 'x' }));
    expect(cases).toHaveLength(28);
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
        'synthetic-suicide-prevention-walk',
        'synthetic-amber-alert',
        'synthetic-sexual-offender-notice',
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
    // Sensitive topics from a city source, which the model called Tier 1: code holds them.
    for (const id of [
      'synthetic-suicide-prevention-walk',
      'synthetic-sexual-offender-notice',
      'synthetic-amber-alert',
    ]) {
      expect(byId[id], id).toMatchObject({ tier: 3, status: 'in_review', failures: [] });
    }
    expect(summary).toMatchObject({ cases: 6, passed: 6, safetyFailures: 0, verbatimQuoteRate: 1 });
  });
});

describe('eval harness with the meeting splitter (a live-only variant until recorded)', () => {
  // The real Delray Beach commission actions (recorded from its Legistar API).
  async function delrayCase() {
    const records = await legistarAdapter.fetch(
      {
        id: 'eval',
        townId: 'eval',
        kind: 'agenda',
        platform: 'legistar',
        url: 'https://delraybeach.legistar.com/',
        config: { timezone: 'America/New_York', pastDays: 14, aheadDays: 14 },
      },
      null,
      {
        fetcher: new Fetcher({
          fetchImpl: replayFetch(
            fileURLToPath(
              new URL('../../adapters/fixtures/legistar/delray-events.json', import.meta.url),
            ),
          ),
          sleep: async () => {},
          now: () => 0,
          minIntervalMs: 0,
        }),
        now: new Date('2026-10-16T12:00:00Z'),
      },
    );
    return loadEvalCases(casesPath, (_f, id) => {
      // Other real cases (Boca's releases) aren't used here.
      const r = records.find((x) => x.externalId === id);
      return { title: r?.title ?? '', text: r?.text ?? '' };
    }).filter((c) => c.id === 'real-delray-commission-actions');
  }

  it('judges a split meeting on all of its decision stories', async () => {
    expect(EVAL_VARIANTS['meeting-split']).toEqual({ 'meeting-split': { disabled: false } });
    const { db: own, drop: dropOwn } = await createTestDb();
    try {
      const loaded = loadTowns(townsDir).filter((t) => t.config.slug === 'boca-raton');
      await syncTowns(
        own,
        loaded.map((t) => ({ ...t, config: { ...t.config, sources: [] } })),
      );
      const town = (await getTownBySlug(own, 'boca-raton'))!;
      const llm = { ...naiveModel(EVAL_VARIANTS['meeting-split']), db: own };
      const summary = await runEvals(own, { 'delray-beach': town.id }, await delrayCase(), {
        llm,
        now: NOW,
      });
      const [result] = summary.results;
      // Three resolutions, three stories: each with its own verbatim claim.
      expect(result).toMatchObject({ skip: null, claims: 3, verbatimClaims: 3, failures: [] });
      expect(result!.tier).toBeLessThanOrEqual(2);
    } finally {
      await dropOwn();
    }
  });

  it('with the splitter off (the routing as it ships), the same case is one recap', async () => {
    const town = (await getTownBySlug(db, 'boca-raton'))!;
    const summary = await runEvals(db, { 'delray-beach': town.id }, await delrayCase(), {
      llm: naiveModel(),
      now: NOW,
    });
    expect(summary.results[0]).toMatchObject({ skip: null, claims: 1, failures: [] });
  });
});
