import { fileURLToPath } from 'node:url';
import { defaultTheme, loadTowns, parseTownConfig } from '@towncore/config';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/client';
import { articles, corrections, records, sources, subscribers, towns } from '../src/schema';
import { syncTowns } from '../src/towns';
import { createTestDb } from '../src/testing';

const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));

let db: Db;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  await syncTowns(db, loadTowns(townsDir));
});
afterAll(async () => drop());

async function boca() {
  const [town] = await db.select().from(towns).where(eq(towns.slug, 'boca-raton'));
  return town!;
}

// Postgres reports the constraint name on the driver error's `cause`.
async function expectViolation(promise: Promise<unknown>, constraint: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, `expected ${constraint} to reject the write`).toBeDefined();
  const cause = (error as { cause?: { constraint_name?: string } }).cause;
  expect(cause?.constraint_name).toBe(constraint);
}

describe('towns:sync', () => {
  it('stores the Boca theme from its theme file', async () => {
    const town = await boca();
    expect((town.theme as { type: string }).type).toBe('newsreader-publicsans');
  });

  it('creates Boca Raton as a draft town', async () => {
    const town = await boca();
    expect(town).toMatchObject({
      siteName: 'Boca Town Square',
      domain: 'bocatownsquare.com',
      status: 'draft',
      tier: 'large',
      timezone: 'America/New_York',
    });
  });

  it('updates config but never touches status or readiness_score', async () => {
    await db
      .update(towns)
      .set({ status: 'live', readinessScore: 12 })
      .where(eq(towns.slug, 'boca-raton'));
    const [loaded] = loadTowns(townsDir).filter((t) => t.config.slug === 'boca-raton');
    await syncTowns(db, [
      { ...loaded!, config: { ...loaded!.config, site_name: 'Renamed Square' } },
    ]);

    const town = await boca();
    expect(town).toMatchObject({ siteName: 'Renamed Square', status: 'live', readinessScore: 12 });

    await syncTowns(db, loadTowns(townsDir));
    await db
      .update(towns)
      .set({ status: 'draft', readinessScore: null })
      .where(eq(towns.slug, 'boca-raton'));
  });

  it('syncs verified YAML sources, skips TBD ones, and is idempotent', async () => {
    const [loaded] = loadTowns(townsDir).filter((t) => t.config.slug === 'boca-raton');
    const withSource = {
      ...loaded!,
      config: {
        ...loaded!.config,
        sources: [
          ...loaded!.config.sources,
          {
            kind: 'events' as const,
            platform: 'civicplus',
            url: 'https://www.myboca.us/RSSFeed.aspx?ModID=58&CID=29',
            schedule: '1h',
          },
        ],
      },
    };
    const first = await syncTowns(db, [withSource]);
    expect(first).toMatchObject({ sources: 2, skippedSources: 1 });
    await syncTowns(db, [withSource]);
    const town = await boca();
    const rows = await db.select().from(sources).where(eq(sources.townId, town.id));
    const nws = rows.filter((r) => r.key === 'weather:nws:FLZ168');
    expect(nws).toHaveLength(1);
    expect(nws[0]).toMatchObject({ platform: 'nws', adapter: 'nws', config: { zone: 'FLZ168' } });
    const calendar = rows.filter((r) => r.key?.startsWith('events:civicplus:'));
    expect(calendar).toHaveLength(1);
    expect(calendar[0]).toMatchObject({
      schedule: '1h',
      url: 'https://www.myboca.us/RSSFeed.aspx?ModID=58&CID=29',
    });
  });

  it('rejects a second town with the same domain', async () => {
    const [loaded] = loadTowns(townsDir).filter((t) => t.config.slug === 'boca-raton');
    await expect(
      syncTowns(db, [{ ...loaded!, config: { ...loaded!.config, slug: 'boca-copy' } }]),
    ).rejects.toThrow();
  });
});

describe('articles constraints', () => {
  let townId: string;
  let recordId: string;
  const valid = () => ({
    townId,
    slug: `story-${Math.random().toString(36).slice(2)}`,
    headline: 'Council approves budget',
    bodyMd: 'Body.',
    beat: 'government',
    tier: 2,
    status: 'published' as const,
    byline: 'Boca Town Square Newsroom (AI-assisted)',
    sourceRecordIds: [recordId],
    publishedAt: new Date(),
  });

  beforeEach(async () => {
    townId = (await boca()).id;
    if (!recordId) {
      const [source] = await db
        .insert(sources)
        .values({ townId, kind: 'agenda', platform: 'test', adapter: 'test' })
        .returning();
      const [record] = await db
        .insert(records)
        .values({
          sourceId: source!.id,
          townId,
          externalId: 'r1',
          type: 'agenda',
          contentHash: 'h',
        })
        .returning();
      recordId = record!.id;
    }
  });

  it('accepts a valid published article', async () => {
    await expect(db.insert(articles).values(valid())).resolves.toBeDefined();
  });

  it('rejects a published article without the AI-assisted byline (rule 2)', async () => {
    await expectViolation(
      db.insert(articles).values({ ...valid(), byline: 'Staff Reporter' }),
      'articles_public_byline',
    );
  });

  it('allows a reviewer suffix on the byline', async () => {
    await expect(
      db.insert(articles).values({
        ...valid(),
        byline: 'Boca Town Square Newsroom (AI-assisted). Reviewed by Jane Editor',
      }),
    ).resolves.toBeDefined();
  });

  it('rejects a published article with no sources (rule 4)', async () => {
    await expectViolation(
      db.insert(articles).values({ ...valid(), sourceRecordIds: [] }),
      'articles_public_sources',
    );
  });

  it('rejects publishing without published_at', async () => {
    await expectViolation(
      db.insert(articles).values({ ...valid(), publishedAt: null }),
      'articles_public_published_at',
    );
  });

  it('never lets a Tier 4 article be anything but blocked or rejected (rule 5)', async () => {
    await expectViolation(
      db.insert(articles).values({ ...valid(), tier: 4 }),
      'articles_tier4_never_public',
    );
    await expectViolation(
      db.insert(articles).values({ ...valid(), tier: 4, status: 'draft' }),
      'articles_tier4_never_public',
    );
    await expect(
      db.insert(articles).values({ ...valid(), tier: 4, status: 'blocked' }),
    ).resolves.toBeDefined();
  });

  it('allows drafts without byline format or sources', async () => {
    await expect(
      db.insert(articles).values({
        ...valid(),
        status: 'draft',
        byline: '',
        sourceRecordIds: [],
        publishedAt: null,
      }),
    ).resolves.toBeDefined();
  });

  it('rejects duplicate slugs within a town', async () => {
    const article = valid();
    await db.insert(articles).values(article);
    await expectViolation(db.insert(articles).values(article), 'articles_town_slug_uq');
  });

  it('keeps corrections: an article with a correction cannot be deleted', async () => {
    const [article] = await db.insert(articles).values(valid()).returning();
    await db.insert(corrections).values({ articleId: article!.id, note: 'Fixed a date.' });
    await expectViolation(
      db.delete(articles).where(eq(articles.id, article!.id)),
      'corrections_article_id_articles_id_fk',
    );
  });
});

describe('other constraints', () => {
  it('dedupes records by (source_id, external_id)', async () => {
    const townId = (await boca()).id;
    const [source] = await db
      .insert(sources)
      .values({ townId, kind: 'permits', platform: 'test', adapter: 'test' })
      .returning();
    const record = {
      sourceId: source!.id,
      townId,
      externalId: 'p1',
      type: 'permit',
      contentHash: 'h',
    };
    await db.insert(records).values(record);
    await expectViolation(db.insert(records).values(record), 'records_source_external_uq');
  });

  it('treats subscriber emails case-insensitively per town', async () => {
    const townId = (await boca()).id;
    await db.insert(subscribers).values({ townId, email: 'reader@example.com' });
    await expectViolation(
      db.insert(subscribers).values({ townId, email: 'Reader@Example.com' }),
      'subscribers_town_email_uq',
    );
  });

  it('parses a config with a different town without touching Boca', async () => {
    const other = parseTownConfig(`
slug: test-town
name: Test Town
state: FL
county: Test
timezone: America/New_York
site_name: Test Town Square
domain: testtownsquare.com
tier: small
newsletter_send_time: "06:30"
agencies: [City of Test Town]
pricing: { sponsored_slot_usd: 199, enhanced_usd: 39 }
`);
    await syncTowns(db, [{ config: other, theme: defaultTheme, hasThemeFile: false }]);
    expect((await boca()).siteName).toBe('Boca Town Square');
    const [synced] = await db.select().from(towns).where(eq(towns.slug, 'test-town'));
    expect(synced!.theme).toBeNull(); // no theme file → network default at render time
  });
});
