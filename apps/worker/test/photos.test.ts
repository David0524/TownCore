import { fileURLToPath } from 'node:url';
import type { Fetcher } from '@towncore/adapters';
import { loadTowns } from '@towncore/config';
import { articles, eq, getTownBySlug, images, syncTowns, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { assignArticleImage } from '@towncore/pipeline';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drawStockPhotos } from '../src/photos';

// The worker's stock-photo job (§11c): guides only, off without a key, each guide once.
let db: Db;
let drop: () => Promise<void>;
const searches: string[] = [];
const fetcher = {
  getJson: async (url: string) => {
    if (!url.includes('/search/photos')) return {};
    const q = new URL(url).searchParams.get('query')!;
    searches.push(q);
    return {
      results: [
        {
          id: `p-${q}`,
          width: 4000,
          height: 3000,
          color: null,
          description: null,
          alt_description: `${q} on a sunny day`,
          urls: { raw: `https://images.unsplash.com/photo-${searches.length}` },
          links: {
            html: 'https://unsplash.com/photos/x',
            download_location: `https://api.unsplash.com/photos/p${searches.length}/download`,
          },
          user: { name: 'Sample', links: { html: 'https://unsplash.com/@sample' } },
        },
      ],
    };
  },
} as unknown as Fetcher;
const logger = pino({ level: 'silent' });

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));
  await syncTowns(
    db,
    loadTowns(townsDir)
      .filter((t) => t.config.slug === 'boca-raton')
      .map((t) => ({ ...t, config: { ...t.config, sources: [], guides: [] } })),
  );
  const townId = (await getTownBySlug(db, 'boca-raton'))!.id;
  const base = {
    townId,
    bodyMd: 'Body.',
    beat: 'community',
    tier: 1,
    byline: 'Boca Town Square Newsroom (AI-assisted)',
    sourceRecordIds: ['00000000-0000-4000-8000-000000000001'],
    publishedAt: new Date(),
  };
  const rows = await db
    .insert(articles)
    .values([
      {
        ...base,
        slug: 'g1',
        headline: 'Recycling',
        status: 'published',
        kind: 'guide',
        guideTopic: 'recycling',
      },
      {
        ...base,
        slug: 'g2',
        headline: 'Voting',
        status: 'in_review',
        kind: 'guide',
        guideTopic: 'voting',
      },
      {
        ...base,
        slug: 'g3',
        headline: 'Pets',
        status: 'rejected',
        kind: 'guide',
        guideTopic: 'pets',
      },
      { ...base, slug: 's1', headline: 'A story', status: 'published', kind: 'story' },
    ])
    .returning();
  // As the writer leaves them: a card, not yet checked with network options.
  for (const row of rows) await assignArticleImage(db, row.id);
});
afterAll(async () => drop());

describe('drawStockPhotos', () => {
  it('does nothing without an access key', async () => {
    expect(await drawStockPhotos(db, fetcher, null, logger)).toEqual({ photos: 0, tried: 0 });
    expect(searches).toEqual([]);
  });

  it('gives published and in-review guides a photo once, never stories or rejected guides', async () => {
    const key = { accessKey: 'k' };
    expect(await drawStockPhotos(db, fetcher, key, logger)).toEqual({ photos: 2, tried: 2 });
    expect(searches.sort()).toEqual(['recycling bins', 'voting booth']);
    expect(await drawStockPhotos(db, fetcher, key, logger)).toEqual({ photos: 0, tried: 0 });
    const kinds = await db
      .select({ slug: articles.slug, kind: images.kind })
      .from(images)
      .innerJoin(articles, eq(articles.id, images.articleId));
    expect(Object.fromEntries(kinds.map((k) => [k.slug, k.kind]))).toEqual({
      g1: 'stock',
      g2: 'stock',
      g3: 'typographic-card',
      s1: 'typographic-card',
    });
  });
});
