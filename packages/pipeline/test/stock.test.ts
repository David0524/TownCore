import { fileURLToPath } from 'node:url';
import type { Fetcher } from '@towncore/adapters';
import { loadTowns } from '@towncore/config';
import { articles, eq, getTownBySlug, images, syncTowns, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assignArticleImage } from '../src/images';

// Stock photos for evergreen guides (CLAUDE.md §11c; Unsplash).
const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));

const photo = (id: string, alt: string | null) => ({
  id,
  width: 6000,
  height: 4000,
  color: '#d9d9d9',
  description: null,
  alt_description: alt,
  urls: { raw: `https://images.unsplash.com/photo-${id}?ixid=${id}` },
  links: {
    html: `https://unsplash.com/photos/${id}`,
    download_location: `https://api.unsplash.com/photos/${id}/download?ixid=${id}`,
  },
  user: { name: `Photographer ${id}`, links: { html: `https://unsplash.com/@p${id}` } },
});

let db: Db;
let drop: () => Promise<void>;
let townId: string;
let calls: string[] = [];
const fetcher = {
  getJson: async (url: string) => {
    calls.push(url);
    if (url.includes('/search/photos')) {
      return {
        results: [
          photo('a', 'Green recycling bins on a sidewalk.'),
          photo('b', null),
          photo('c', 'Trash cans'),
        ],
      };
    }
    return {};
  },
} as unknown as Fetcher;
const unsplash = { accessKey: 'test-key' };

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  await syncTowns(
    db,
    loadTowns(townsDir)
      .filter((t) => t.config.slug === 'boca-raton')
      .map((t) => ({ ...t, config: { ...t.config, sources: [], guides: [] } })),
  );
  townId = (await getTownBySlug(db, 'boca-raton'))!.id;
});
afterAll(async () => drop());
beforeEach(async () => {
  calls = [];
  await db.delete(articles);
});

let n = 0;
async function article(over: Partial<typeof articles.$inferInsert> = {}) {
  const [a] = await db
    .insert(articles)
    .values({
      townId,
      slug: `stock-${++n}`,
      headline: 'How recycling works in Boca Raton',
      bodyMd: 'Recycling is collected once a week.',
      beat: 'community',
      tier: 1,
      status: 'published',
      byline: 'Boca Town Square Newsroom',
      sourceRecordIds: ['00000000-0000-4000-8000-000000000001'],
      publishedAt: new Date(),
      kind: 'guide',
      guideTopic: 'recycling',
      ...over,
    })
    .returning();
  return a!;
}

describe('stock photos for guides', () => {
  it("picks the topic's photo, credits it, and tells Unsplash it is used", async () => {
    const guide = await article();
    const choice = await assignArticleImage(db, guide.id, { fetcher, unsplash });
    expect(choice).toMatchObject({
      kind: 'stock',
      alt: 'Stock photo: green recycling bins on a sidewalk.',
      license: 'Unsplash License',
      attribution: 'Photo by Photographer a on Unsplash',
      sourceUrl: 'https://unsplash.com/photos/a',
      spec: { type: 'stock', provider: 'unsplash', photoId: 'a', photographer: 'Photographer a' },
    });
    // The guide topic's fixed search, then one download ping for the photo used.
    expect(new URL(calls[0]!).searchParams.get('query')).toBe('recycling bins');
    expect(calls[1]).toBe('https://api.unsplash.com/photos/a/download?ixid=a');
    expect(calls).toHaveLength(2);
    const [row] = await db.select().from(images).where(eq(images.articleId, guide.id));
    expect(row!.mapCheckedAt).not.toBeNull();
  });

  it('never reuses a photo within a town, and skips photos with nothing to write alt text from', async () => {
    await assignArticleImage(db, (await article()).id, { fetcher, unsplash });
    const other = await article({ guideTopic: 'trash-pickup', headline: 'How trash pickup works' });
    const choice = await assignArticleImage(db, other.id, { fetcher, unsplash });
    // "a" is taken, "b" has no description: "c".
    expect(choice.spec).toMatchObject({ photoId: 'c' });
    expect(choice.alt).toBe('Stock photo: trash cans.');
    // Re-running on the first guide keeps its own photo.
    const first = (
      await db.select().from(articles).where(eq(articles.guideTopic, 'recycling'))
    )[0]!;
    expect((await assignArticleImage(db, first.id, { fetcher, unsplash })).spec).toMatchObject({
      photoId: 'a',
    });
  });

  it('only for guides: a community story never gets a stock photo', async () => {
    const story = await article({
      kind: 'story',
      guideTopic: null,
      headline: 'Library hours change',
    });
    expect((await assignArticleImage(db, story.id, { fetcher, unsplash })).kind).toBe(
      'typographic-card',
    );
    expect(calls).toEqual([]);
  });

  it('without a key the guide keeps its card, and a re-run without network options queues it again', async () => {
    const guide = await article();
    expect((await assignArticleImage(db, guide.id, { fetcher })).kind).toBe('typographic-card');
    expect(calls).toEqual([]);
    await assignArticleImage(db, guide.id, { fetcher, unsplash });
    // Rewritten or approved without the network: back to the card, check cleared for the job.
    expect((await assignArticleImage(db, guide.id)).kind).toBe('typographic-card');
    const [row] = await db.select().from(images).where(eq(images.articleId, guide.id));
    expect(row!.mapCheckedAt).toBeNull();
  });
});
