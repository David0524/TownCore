import { and, articles, corrections, eq, records, sources, type Db } from '@towncore/db';
import { buildByline } from '@towncore/pipeline';

// Clearly labeled test articles for dev and CI (plan: "Test content"). Every slug starts with
// "test-" (always noindex) and every headline with "[TEST]". Idempotent: re-running replaces them.

const TEST_PLATFORM = 'test-fixture';

type TestStory = {
  slug: string;
  headline: string;
  dek: string;
  beat: string;
  paragraphs: string[];
  source: { title: string; url: string };
  correction?: string;
};

const testParagraph = (siteName: string, n: number) =>
  `This is test paragraph ${n}. It exists so ${siteName} can show how an article page looks, ` +
  'where its sources appear and where labeled slots go. It does not describe a real event, and ' +
  'nothing in it should be read as news.';

export function testStories(siteName: string, townSlug: string): TestStory[] {
  const paragraphs = (count: number) =>
    Array.from({ length: count }, (_, i) => testParagraph(siteName, i + 1));
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
  return [
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
    },
  ];
}

export async function seedTestContent(
  db: Db,
  town: { id: string; slug: string; siteName: string },
) {
  await db.transaction(async (tx) => {
    // Remove earlier test content for this town (corrections first; they restrict deletes).
    const old = await tx
      .select({ id: articles.id, slug: articles.slug })
      .from(articles)
      .where(eq(articles.townId, town.id));
    for (const article of old.filter((a) => a.slug.startsWith('test-'))) {
      await tx.delete(corrections).where(eq(corrections.articleId, article.id));
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
      const publishedAt = new Date(Date.now() - 2 * 3_600_000);
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
      const [article] = await tx
        .insert(articles)
        .values({
          townId: town.id,
          slug: story.slug,
          headline: story.headline,
          dek: story.dek,
          bodyMd: story.paragraphs.join('\n\n'),
          beat: story.beat,
          tier: 2,
          status: story.correction ? 'corrected' : 'published',
          byline: buildByline(town.siteName),
          sourceRecordIds: [record!.id],
          publishedAt,
          createdAt: publishedAt,
          updatedAt: publishedAt,
        })
        .returning();
      if (story.correction) {
        await tx.insert(corrections).values({ articleId: article!.id, note: story.correction });
      }
    }
  });
}
