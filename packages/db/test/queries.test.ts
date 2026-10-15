import { fileURLToPath } from 'node:url';
import { loadTowns } from '@towncore/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/client';
import {
  getActiveCampaign,
  getPublishedArticle,
  getSourceRecords,
  listTownCorrections,
  getTownByHost,
  getTownBySlug,
  listLiveTowns,
  listPublishedArticles,
  normalizeHost,
} from '../src/queries';
import { articles, campaigns, corrections, records, sources, towns } from '../src/schema';
import { createTestDb } from '../src/testing';
import { syncTowns } from '../src/towns';
import { eq } from 'drizzle-orm';

const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));

describe('normalizeHost', () => {
  it.each([
    ['bocatownsquare.com', 'bocatownsquare.com'],
    ['www.bocatownsquare.com', 'bocatownsquare.com'],
    ['BocaTownSquare.com', 'bocatownsquare.com'],
    ['bocatownsquare.com:3000', 'bocatownsquare.com'],
    ['bocatownsquare.com.', 'bocatownsquare.com'],
    ['boca-raton.localhost:3000', 'boca-raton.localhost'],
    ['localhost', 'localhost'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeHost(input)).toBe(expected);
  });

  it.each([null, undefined, '', 'bad host', "x'; drop table towns;--", 'a/b', '[::1]:3000'])(
    'rejects %j',
    (input) => {
      expect(normalizeHost(input)).toBeNull();
    },
  );
});

describe('town and article queries', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let townId: string;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    await syncTowns(db, loadTowns(townsDir));
    townId = (await getTownBySlug(db, 'boca-raton'))!.id;
  });
  afterAll(async () => drop());

  it('finds Boca by its domain', async () => {
    expect((await getTownByHost(db, 'bocatownsquare.com'))?.slug).toBe('boca-raton');
  });

  it('finds a town by an extra domain', async () => {
    await db
      .update(towns)
      .set({ extraDomains: ['boca.example.org'] })
      .where(eq(towns.id, townId));
    expect((await getTownByHost(db, 'boca.example.org'))?.slug).toBe('boca-raton');
    await db.update(towns).set({ extraDomains: [] }).where(eq(towns.id, townId));
  });

  it('returns null for unknown hosts', async () => {
    expect(await getTownByHost(db, 'example.com')).toBeNull();
  });

  it('lists only live towns', async () => {
    expect(await listLiveTowns(db)).toEqual([]);
    await db.update(towns).set({ status: 'live' }).where(eq(towns.id, townId));
    expect((await listLiveTowns(db)).map((t) => t.slug)).toEqual(['boca-raton']);
    await db.update(towns).set({ status: 'draft' }).where(eq(towns.id, townId));
  });

  it('lists published and corrected articles only, newest first', async () => {
    const [source] = await db
      .insert(sources)
      .values({ townId, kind: 'agenda', platform: 'test', adapter: 'test' })
      .returning();
    const [record] = await db
      .insert(records)
      .values({ sourceId: source!.id, townId, externalId: 'q1', type: 'agenda', contentHash: 'h' })
      .returning();
    const base = {
      townId,
      bodyMd: 'Body.',
      beat: 'government',
      tier: 2,
      byline: 'Boca Town Square Newsroom (AI-assisted)',
      sourceRecordIds: [record!.id],
    };
    await db.insert(articles).values([
      {
        ...base,
        slug: 'old',
        headline: 'Old',
        status: 'published',
        publishedAt: new Date('2026-01-01'),
      },
      {
        ...base,
        slug: 'new',
        headline: 'New',
        status: 'corrected',
        publishedAt: new Date('2026-02-01'),
      },
      { ...base, slug: 'draft', headline: 'Draft', status: 'draft' },
      { ...base, slug: 'review', headline: 'Review', status: 'in_review' },
    ]);
    expect((await listPublishedArticles(db, townId)).map((a) => a.slug)).toEqual(['new', 'old']);
    expect(await listPublishedArticles(db, townId, { beat: 'schools' })).toEqual([]);
    expect((await listPublishedArticles(db, townId, { limit: 1 })).map((a) => a.slug)).toEqual([
      'new',
    ]);
  });

  it('picks the active, in-window, highest-priority campaign for a slot', async () => {
    const now = new Date('2026-06-01T12:00:00Z');
    const day = 86_400_000;
    const base = { townId, slot: 'home.top', creative: { headline: 'x' } };
    await db.insert(campaigns).values([
      {
        ...base,
        priority: 1,
        status: 'active',
        startsAt: new Date(now.getTime() - day),
        creative: { headline: 'low' },
      },
      {
        ...base,
        priority: 5,
        status: 'active',
        startsAt: new Date(now.getTime() - day),
        creative: { headline: 'high' },
      },
      {
        ...base,
        priority: 9,
        status: 'paused',
        startsAt: new Date(now.getTime() - day),
        creative: { headline: 'paused' },
      },
      {
        ...base,
        priority: 9,
        status: 'active',
        startsAt: new Date(now.getTime() + day),
        creative: { headline: 'future' },
      },
      {
        ...base,
        priority: 9,
        status: 'active',
        startsAt: new Date(now.getTime() - 2 * day),
        endsAt: new Date(now.getTime() - day),
        creative: { headline: 'ended' },
      },
      {
        ...base,
        slot: 'rail.box',
        priority: 9,
        status: 'active',
        startsAt: new Date(now.getTime() - day),
        creative: { headline: 'other slot' },
      },
    ]);
    const campaign = await getActiveCampaign(db, townId, 'home.top', now);
    expect(campaign?.creative).toEqual({ headline: 'high' });
    expect(await getActiveCampaign(db, townId, 'article.inline', now)).toBeNull();
  });

  it('serves only public articles by slug, with sources in citation order and corrections', async () => {
    const [source] = await db
      .insert(sources)
      .values({ townId, kind: 'agenda', platform: 'test', adapter: 'test' })
      .returning();
    const [r1, r2] = await db
      .insert(records)
      .values([
        { sourceId: source!.id, townId, externalId: 'c1', type: 'agenda', contentHash: 'a' },
        { sourceId: source!.id, townId, externalId: 'c2', type: 'agenda', contentHash: 'b' },
      ])
      .returning();
    const base = {
      townId,
      bodyMd: 'Body.',
      beat: 'government',
      tier: 2,
      byline: 'Boca Town Square Newsroom (AI-assisted)',
      sourceRecordIds: [r2!.id, r1!.id],
    };
    const [pub] = await db
      .insert(articles)
      .values({
        ...base,
        slug: 'pub',
        headline: 'Pub',
        status: 'published',
        publishedAt: new Date(),
      })
      .returning();
    await db
      .insert(articles)
      .values({ ...base, slug: 'hidden', headline: 'Hidden', status: 'in_review' });
    await db.insert(corrections).values({ articleId: pub!.id, note: 'Fixed a date.' });

    expect((await getPublishedArticle(db, townId, 'pub'))?.id).toBe(pub!.id);
    expect(await getPublishedArticle(db, townId, 'hidden')).toBeNull();
    expect((await getSourceRecords(db, pub!.sourceRecordIds)).map((r) => r.externalId)).toEqual([
      'c2',
      'c1',
    ]);
    expect(await getSourceRecords(db, [])).toEqual([]);
    const townCorrections = await listTownCorrections(db, townId);
    expect(townCorrections.map((c) => c.article.slug)).toContain('pub');
  });
});
