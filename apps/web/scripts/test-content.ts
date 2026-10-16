import {
  and,
  articleLinks,
  articles,
  articleStatsDaily,
  articleUpdates,
  corrections,
  eq,
  or,
  pins,
  records,
  sources,
  type Db,
} from '@towncore/db';
import { entityKey } from '@towncore/config';
import { assignArticleImage, buildByline, linkArticleEntities } from '@towncore/pipeline';

// Clearly labeled test articles for dev and CI (plan: "Test content"). Every headline starts with
// "[TEST]", and every slug with "test-" (always noindex) except the fictional live Feed Town's
// "fixture-" stories, which exist to test sitemaps and feeds. Idempotent: re-running replaces them.

const TEST_PLATFORM = 'test-fixture';

type TestStory = {
  slug: string;
  headline: string;
  dek: string;
  beat: string;
  paragraphs: string[];
  source: { title: string; url: string };
  correction?: string;
  /** How long ago it was published. Default 2 hours. */
  hoursAgo?: number;
  /** Fictional streets the story names, linked as topics (M4 PR D) and written into its text. */
  streets?: string[];
  /** A roundup: extra sample filing records this many days ago each (one record per entry). */
  roundupDaysAgo?: number[];
};

const testParagraph = (siteName: string, n: number) =>
  `This is test paragraph ${n}. It exists so ${siteName} can show how an article page looks, ` +
  'where its sources appear and where labeled slots go. It does not describe a real event, and ' +
  'nothing in it should be read as news.';

export function testStories(siteName: string, townSlug: string): TestStory[] {
  const paragraphs = (count: number) =>
    Array.from({ length: count }, (_, i) => testParagraph(siteName, i + 1));
  if (townSlug === 'feed-town') {
    // A fictional *live* town for the sitemap and feed tests. "fixture-" slugs are listed like
    // real stories; the "test-" one must never be.
    const source = {
      title: 'Fictional town notice (test source)',
      url: 'https://example.com/feed-town',
    };
    return [
      {
        slug: 'fixture-council-vote',
        headline: '[TEST] Feed Town council approves a sample budget & plan',
        dek: 'A fictional story for the feed tests. It is not news.',
        beat: 'government',
        paragraphs: paragraphs(4),
        source,
      },
      {
        slug: 'fixture-park-opens',
        headline: '[TEST] Fictional park reopens',
        dek: 'Older fictional story: in the sitemap, not in the news sitemap.',
        beat: 'community',
        paragraphs: paragraphs(4),
        source,
        hoursAgo: 72,
      },
      {
        slug: 'test-never-listed',
        headline: '[TEST] A test fixture that must never be listed',
        dek: 'Test slugs are excluded from every sitemap and feed.',
        beat: 'government',
        paragraphs: paragraphs(4),
        source,
      },
    ];
  }
  if (townSlug === 'boca-raton') {
    return [
      {
        slug: 'test-article',
        headline: `[TEST] This is a test article for ${siteName}`,
        dek: 'A sample story used to check the article page. It is not news.',
        beat: 'government',
        paragraphs: paragraphs(10),
        source: {
          title: 'City of Boca Raton website (test source)',
          url: 'https://www.myboca.us/',
        },
        correction: 'Test correction: this note shows how a correction appears on a story.',
      },
    ];
  }
  // The fictional family showcases (Harbor Point, heritage; Pine Hollow, community) get a few
  // short items so their fronts and section lists have something to show.
  const extra = (prefix: string): TestStory[] =>
    [
      ['government', 'Select board sets a sample public hearing date', 5],
      ['business', 'Three fictional businesses register this week', 8],
      ['schools', 'School committee reviews a sample bus schedule', 26],
      ['community', 'Sample library hours change for the season', 50],
    ].map(([beat, headline, hoursAgo]) => ({
      slug: `test-${prefix}-${beat}`,
      headline: `[TEST] ${headline}`,
      dek: 'A short fictional item for the front page. It is not news.',
      beat: beat as string,
      paragraphs: paragraphs(4),
      source: {
        title: 'Sample town notice (fictional test source)',
        url: `https://example.com/${townSlug}-notices`,
      },
      hoursAgo: hoursAgo as number,
      // Three items share a fictional street, so it has a topic page and related coverage.
      streets: prefix === 'harbor' && beat !== 'business' ? ['Sample Harbor Road'] : [],
    }));
  return [
    ...(townSlug === 'harbor-point' ? extra('harbor') : []),
    // A roundup over several days, so the image router draws a data graphic (§11c).
    ...(townSlug === 'harbor-point'
      ? [
          {
            slug: 'test-harbor-roundup',
            headline: '[TEST] Sample new business filings this week',
            dek: 'A fictional roundup counted from sample records. It is not news.',
            beat: 'business',
            paragraphs: paragraphs(4),
            source: {
              title: 'Sample filings (fictional test source)',
              url: 'https://example.com/harbor-point-filings',
            },
            hoursAgo: 30,
            roundupDaysAgo: [1, 1, 2, 4, 4, 4],
          },
        ]
      : []),
    ...(townSlug === 'pine-hollow' ? extra('pine') : []),
    {
      slug: 'test-site-plan',
      headline: `[TEST] Fictional planning board reviews a sample site plan`,
      dek: 'A sample development story for a fictional town. It is not news.',
      beat: 'development',
      paragraphs: paragraphs(10),
      source: {
        title: 'Sample agenda (fictional test source)',
        url: 'https://example.com/harbor-point-agenda',
      },
      streets: townSlug === 'harbor-point' ? ['Sample Harbor Road'] : [],
    },
  ];
}

export async function seedTestContent(
  db: Db,
  town: { id: string; slug: string; siteName: string },
) {
  const written: string[] = [];
  const topics: Array<{ id: string; streets: string[] }> = [];
  await db.transaction(async (tx) => {
    // Remove earlier test content for this town (rows that reference an article go first).
    const old = await tx
      .select({ id: articles.id, slug: articles.slug })
      .from(articles)
      .where(eq(articles.townId, town.id));
    for (const article of old.filter((a) => /^(test|fixture)-/.test(a.slug))) {
      await tx.delete(corrections).where(eq(corrections.articleId, article.id));
      await tx.delete(articleUpdates).where(eq(articleUpdates.articleId, article.id));
      await tx.delete(pins).where(eq(pins.articleId, article.id));
      await tx.delete(articleStatsDaily).where(eq(articleStatsDaily.articleId, article.id));
      await tx
        .delete(articleLinks)
        .where(
          or(eq(articleLinks.fromArticleId, article.id), eq(articleLinks.toArticleId, article.id)),
        );
      await tx.delete(articles).where(eq(articles.id, article.id));
    }
    const oldSources = await tx
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.townId, town.id), eq(sources.platform, TEST_PLATFORM)));
    for (const source of oldSources) {
      await tx.delete(records).where(eq(records.sourceId, source.id));
      await tx.delete(sources).where(eq(sources.id, source.id));
    }

    const [source] = await tx
      .insert(sources)
      .values({ townId: town.id, kind: 'agenda', platform: TEST_PLATFORM, adapter: TEST_PLATFORM })
      .returning();
    for (const story of testStories(town.siteName, town.slug)) {
      const publishedAt = new Date(Date.now() - (story.hoursAgo ?? 2) * 3_600_000);
      const [record] = await tx
        .insert(records)
        .values({
          sourceId: source!.id,
          townId: town.id,
          externalId: `test-${story.slug}`,
          type: 'agenda',
          title: story.source.title,
          url: story.source.url,
          occurredAt: publishedAt,
          contentHash: `test-${story.slug}`,
        })
        .returning();
      const chart = story.roundupDaysAgo
        ? await tx
            .insert(records)
            .values(
              story.roundupDaysAgo.map((days, i) => ({
                sourceId: source!.id,
                townId: town.id,
                externalId: `test-${story.slug}-filing-${i}`,
                type: 'new-filing',
                title: `SAMPLE BUSINESS ${i + 1} LLC (fictional)`,
                url: story.source.url,
                occurredAt: new Date(Date.now() - days * 86_400_000),
                contentHash: `test-${story.slug}-filing-${i}`,
              })),
            )
            .returning()
        : [];
      const [article] = await tx
        .insert(articles)
        .values({
          townId: town.id,
          slug: story.slug,
          headline: story.headline,
          dek: story.dek,
          bodyMd: [
            ...story.paragraphs,
            ...(story.streets ?? []).map((st) => `The fictional item concerns ${st}.`),
          ].join('\n\n'),
          beat: story.beat,
          tier: 2,
          status: story.correction ? 'corrected' : 'published',
          byline: buildByline(town.siteName),
          sourceRecordIds: [record!.id, ...chart.map((r) => r.id)],
          kind: story.roundupDaysAgo ? 'roundup' : 'story',
          publishedAt,
          createdAt: publishedAt,
          updatedAt: publishedAt,
        })
        .returning();
      if (story.correction) {
        await tx.insert(corrections).values({ articleId: article!.id, note: story.correction });
      }
      written.push(article!.id);
      if (story.streets?.length) topics.push({ id: article!.id, streets: story.streets });
    }
  });
  // Each test article gets its visual from the same router as real stories (§11c).
  for (const id of written) await assignArticleImage(db, id);
  // Topics as the entity job would link them (no model call in fixtures).
  for (const { id, streets } of topics) {
    await linkArticleEntities(
      db,
      { id, townId: town.id },
      streets.map((name) => ({ name, kind: 'street' as const, key: entityKey('street', name) })),
    );
  }
}
