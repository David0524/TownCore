import { fileURLToPath } from 'node:url';
import { loadTowns, type SourceKind, type TownConfig } from '@towncore/config';
import {
  aiUsage,
  articleScores,
  eq,
  getTownBySlug,
  records,
  skippedCandidates,
  sources,
  storyCandidates,
  syncTowns,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import type { Classification } from '@towncore/prompts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runStoryFinder } from '../src/finder';
import type { Llm, LlmProvider } from '../src/llm';
import { classification } from './helpers';

const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));
// Saturday Oct 17 2026, 11 am in Boca.
const NOW = new Date('2026-10-17T15:00:00Z');
const LONG = ' The city said the change takes effect next month.'.repeat(20);

let db: Db;
let drop: () => Promise<void>;
let townId: string;
const sourceIds: Partial<Record<SourceKind, string>> = {};

/** Answers the classify prompt from a table keyed by record title. */
function classifier(table: Record<string, Partial<Classification>>) {
  const calls: string[] = [];
  const provider: LlmProvider = {
    name: 'replay',
    async generate(request) {
      const title = request.input.match(/^Title: (.*)$/m)?.[1] ?? '';
      calls.push(title);
      return {
        text: JSON.stringify(classification(table[title] ?? {})),
        stop: 'end',
        model: 'gemini-flash-lite-latest',
        usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0 },
      };
    },
  };
  const llm: Llm = { db, provider, providerName: 'gemini', now: () => NOW };
  return { llm, calls };
}

async function addRecord(
  kind: SourceKind,
  type: string,
  title: string,
  over: Partial<typeof records.$inferInsert> = {},
) {
  const [row] = await db
    .insert(records)
    .values({
      sourceId: sourceIds[kind]!,
      townId,
      externalId: `${type}:${title}`,
      type,
      title,
      text: `${title}.${LONG}`,
      contentHash: title,
      occurredAt: NOW,
      ...over,
    })
    .returning();
  return row!;
}

async function setConfig(over: Partial<TownConfig>) {
  const [town] = await db.select().from(towns).where(eq(towns.id, townId));
  await db
    .update(towns)
    .set({ config: { ...(town!.config as TownConfig), ...over } })
    .where(eq(towns.id, townId));
}

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  const loaded = loadTowns(townsDir).filter((t) => t.config.slug === 'boca-raton');
  await syncTowns(
    db,
    loaded.map((t) => ({ ...t, config: { ...t.config, sources: [] } })),
  );
  townId = (await getTownBySlug(db, 'boca-raton'))!.id;
  for (const kind of ['city_news', 'police', 'agenda', 'business_filings', 'weather'] as const) {
    const [s] = await db
      .insert(sources)
      .values({ townId, kind, platform: 'test', adapter: 'test', key: kind })
      .returning();
    sourceIds[kind] = s!.id;
  }
});
afterAll(async () => drop());
beforeEach(async () => {
  await db.delete(skippedCandidates);
  await db.delete(articleScores);
  await db.delete(storyCandidates);
  await db.delete(records);
  await db.delete(aiUsage);
  await setConfig({ story_budget: 3, score_threshold: 40, ai_daily_call_cap: 400 });
});

async function candidates() {
  const rows = await db.select().from(storyCandidates).where(eq(storyCandidates.townId, townId));
  const skips = await db.select().from(skippedCandidates);
  const reason = new Map(skips.map((s) => [s.candidateId, s.reason]));
  return Object.fromEntries(
    rows.map((c) => [c.title ?? c.key, { status: c.status, reason: reason.get(c.id), c }]),
  );
}

const high = { impact: 1, novelty: 1, proximity: 1 };

describe('story finder', () => {
  it('builds roundups and alert items in code, without a model', async () => {
    await addRecord('agenda', 'meeting', 'City Council Regular Meeting', {
      occurredAt: new Date('2026-10-20T22:00:00Z'),
    });
    await addRecord('agenda', 'meeting', 'Next-next week', {
      occurredAt: new Date('2026-10-27T22:00:00Z'),
    });
    await addRecord('business_filings', 'new-filing', 'ACME LLC', {
      occurredAt: new Date('2026-10-06T00:00:00Z'),
    });
    await addRecord('business_filings', 'new-filing', 'This week LLC', {
      occurredAt: new Date('2026-10-13T00:00:00Z'),
    });
    await addRecord('business_filings', 'license', 'DOE ROOFING', {
      occurredAt: new Date('2026-10-11T00:00:00Z'),
      raw: { occupation: 'Certified Roofing Contractor', alternateLicenseNumber: 'CCC1234567' },
    });
    // A "Construction Business Information" row has no license number and isn't a license.
    await addRecord('business_filings', 'license', 'DOE ROOFING', {
      occurredAt: new Date('2026-10-11T00:00:00Z'),
      externalId: 'license:DOE ROOFING:QB',
      raw: { occupation: 'Construction Business Information', occupationCode: 'QB' },
    });
    await addRecord('weather', 'alert', 'Flood Watch', { raw: { severity: 'Moderate' } });
    await addRecord('weather', 'alert', 'Rip Current Statement', { raw: { severity: 'Minor' } });

    const report = await runStoryFinder(db, townId, { now: NOW });
    expect(report.roundups.sort()).toEqual([
      'roundup:meetings:2026-10-19',
      'roundup:new-businesses:2026-10-05',
      'roundup:new-licenses:2026-10-05',
    ]);
    expect(report.templates).toBe(1);

    const all = await candidates();
    expect(all['Meetings, week of 2026-10-19']?.c).toMatchObject({
      kind: 'roundup',
      status: 'accepted',
      proposedTier: 1,
    });
    expect(all['Meetings, week of 2026-10-19']?.c.recordIds).toHaveLength(1);
    expect(all['New businesses, week of 2026-10-05']?.c.recordIds).toHaveLength(1);
    expect(all['New contractor licenses, week of 2026-10-05']?.c.recordIds).toHaveLength(1);
    expect(all['Flood Watch']?.c).toMatchObject({ kind: 'template', status: 'accepted' });
    expect(all['Rip Current Statement']).toBeUndefined();

    // Idempotent: a second run creates nothing new.
    const again = await runStoryFinder(db, townId, { now: NOW });
    expect(again).toMatchObject({ roundups: [], templates: 0, candidates: 0 });
  });

  it('classifies, tiers, scores and applies the daily budget, logging every skip', async () => {
    await addRecord('city_news', 'release', 'Council adopts budget', { text: 'short' });
    await addRecord('city_news', 'release-link', 'Newsletter', { text: null });
    for (const t of [
      'Budget vote',
      'Parking rates',
      'Sewer project',
      'Park renovation',
      'Delray event',
      'Library hours',
      'Teen cited',
    ]) {
      await addRecord('city_news', 'release', t);
    }
    await addRecord('police', 'release', 'Burglary arrest');
    const { llm, calls } = classifier({
      'Budget vote': { ...high },
      'Parking rates': { ...high, impact: 0.9 },
      'Sewer project': { ...high, impact: 0.8 },
      'Park renovation': { ...high, impact: 0.7 },
      'Delray event': { ...high, about_this_town: false, town_evidence: 'Delray Beach' },
      'Library hours': { impact: 0, novelty: 0, proximity: 0 },
      'Teen cited': {
        ...high,
        people: [{ name: 'Pat Lee', role: 'minor', context: 'cited' }],
      },
      'Burglary arrest': { ...high, beat: 'public-safety', proposed_tier: 3 },
    });

    const report = await runStoryFinder(db, townId, { llm, now: NOW });
    const all = await candidates();
    const summary = Object.fromEntries(
      Object.entries(all).map(([k, v]) => [k, v.reason ?? v.status]),
    );
    expect(summary).toEqual({
      'Council adopts budget': 'thin_source',
      Newsletter: 'thin_source',
      'Budget vote': 'accepted',
      'Parking rates': 'accepted',
      'Sewer project': 'accepted',
      'Park renovation': 'budget_full',
      'Delray event': 'wrong_town',
      'Library hours': 'below_threshold',
      'Teen cited': 'tier4',
      // Budget 3 → public safety cap floor(3 × 20%) = 0.
      'Burglary arrest': 'public_safety_cap',
    });
    expect(all['Teen cited']?.status).toBe('dropped');
    expect(all['Burglary arrest']?.c.proposedTier).toBe(3);
    expect(all['Budget vote']?.c.newsworthiness).toBe(90);
    // Thin and link records never reach the model.
    expect(calls.sort()).toEqual(
      [
        'Burglary arrest',
        'Delray event',
        'Library hours',
        'Budget vote',
        'Parking rates',
        'Sewer project',
        'Park renovation',
        'Teen cited',
      ].sort(),
    );
    expect(report).toMatchObject({ candidates: 10, accepted: 3, dropped: 1 });
    expect(await db.select().from(articleScores)).toHaveLength(6);

    // Nothing is re-classified on the next run, and the budget stays used for the day.
    await addRecord('city_news', 'release', 'Bridge closure');
    const next = classifier({ 'Bridge closure': { ...high } });
    const again = await runStoryFinder(db, townId, { llm: next.llm, now: NOW });
    expect(next.calls).toEqual(['Bridge closure']);
    expect(again.skipped).toEqual({ budget_full: 1 });
  });

  it('leaves candidates pending without a model, or once the daily cap is hit', async () => {
    await addRecord('city_news', 'release', 'Budget vote');
    await addRecord('city_news', 'release', 'Parking rates');
    expect(await runStoryFinder(db, townId, { now: NOW })).toMatchObject({ pending: 2 });

    await setConfig({ ai_daily_call_cap: 1 });
    const { llm, calls } = classifier({ 'Budget vote': high, 'Parking rates': high });
    const report = await runStoryFinder(db, townId, { llm, now: NOW });
    expect(calls).toHaveLength(1);
    expect(report).toMatchObject({ capReached: true, pending: 1, accepted: 1 });
  });
});
