import { fileURLToPath } from 'node:url';
import { loadTowns } from '@towncore/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/client';
import {
  getTownByHost,
  getTownBySlug,
  listLiveTowns,
  listPublishedArticles,
  normalizeHost,
} from '../src/queries';
import { articles, records, sources, towns } from '../src/schema';
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
});
