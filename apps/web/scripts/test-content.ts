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
  townBasemaps,
  type Db,
} from '@towncore/db';
import { entityKey } from '@towncore/config';
import {
  assignArticleImage,
  buildByline,
  linkArticleEntities,
  type ImageDeps,
} from '@towncore/pipeline';

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
  /** An evergreen guide for this topic (M4 PR F), served under /guides. */
  guideTopic?: string;
  /** A fictional street address written into the text, for a block-level map (M4 PR E). */
  address?: string;
  /** A roundup: extra sample filing records this many days ago each (one record per entry). */
  roundupDaysAgo?: number[];
  /**
   * A meeting recap: the source record is the clerk's recorded actions for this body, and the
   * town's channel has a video of the meeting the same day (owner's decision, 2026-10-16).
   */
  meeting?: { body: string; videoId: string; videoTitle: string };
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
        slug: 'fixture-guide-recycling',
        headline: '[TEST] How recycling works in Feed Town',
        dek: 'A fictional guide: in the guides sitemap, never in feeds or the news sitemap.',
        beat: 'community',
        paragraphs: paragraphs(4),
        source,
        hoursAgo: 30,
        guideTopic: 'recycling',
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
      {
        slug: 'test-meeting-recap',
        headline: `[TEST] Sample meeting recap for ${siteName}`,
        dek: 'A fictional recap used to check the meeting video. It is not news.',
        beat: 'government',
        paragraphs: paragraphs(4),
        source: {
          title: 'Actions: City Commission: Regular Meeting (test source)',
          url: 'https://www.myboca.us/',
        },
        meeting: {
          body: 'City Commission',
          videoId: 'testVideo01',
          videoTitle: 'City Commission Regular Meeting (test video)',
        },
      },
      {
        slug: 'test-guide-trash',
        headline: `[TEST] How trash pickup works (sample guide for ${siteName})`,
        dek: 'A sample guide used to check the guide page. It is not real guidance.',
        beat: 'community',
        paragraphs: paragraphs(5),
        source: {
          title: 'City of Boca Raton sanitation page (test source)',
          url: 'https://www.myboca.us/665/Sanitation',
        },
        hoursAgo: 26,
        guideTopic: 'trash-pickup',
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
      ...(townSlug === 'harbor-point' ? { address: '412 Sample Harbor Road' } : {}),
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
      // Checked just now, so guides show a "Last checked" date.
      .values({
        townId: town.id,
        kind: 'agenda',
        platform: TEST_PLATFORM,
        adapter: TEST_PLATFORM,
        lastOkAt: new Date(),
      })
      .returning();
    for (const story of testStories(town.siteName, town.slug)) {
      const publishedAt = new Date(Date.now() - (story.hoursAgo ?? 2) * 3_600_000);
      const [record] = await tx
        .insert(records)
        .values({
          sourceId: source!.id,
          townId: town.id,
          externalId: `test-${story.slug}`,
          type: story.meeting ? 'meeting-actions' : 'agenda',
          title: story.source.title,
          url: story.source.url,
          occurredAt: publishedAt,
          contentHash: `test-${story.slug}`,
          ...(story.meeting ? { raw: { body: story.meeting.body } } : {}),
        })
        .returning();
      if (story.meeting) {
        await tx.insert(records).values({
          sourceId: source!.id,
          townId: town.id,
          externalId: `test-${story.slug}-video`,
          type: 'meeting-video',
          title: story.meeting.videoTitle,
          url: `https://www.youtube.com/watch?v=${story.meeting.videoId}`,
          occurredAt: new Date(publishedAt.getTime() + 60_000),
          contentHash: `test-${story.slug}-video`,
          raw: {
            videoId: story.meeting.videoId,
            channelTitle: 'Sample city channel (test)',
            embeddable: true,
          },
        });
      }
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
            ...(story.address ? [`The sample plan covers ${story.address}.`] : []),
          ].join('\n\n'),
          beat: story.beat,
          status: story.correction ? 'corrected' : 'published',
          byline: buildByline(town.siteName),
          sourceRecordIds: [record!.id, ...chart.map((r) => r.id)],
          kind: story.guideTopic ? 'guide' : story.roundupDaysAgo ? 'roundup' : 'story',
          guideTopic: story.guideTopic ?? null,
          tier: story.guideTopic ? 1 : 2,
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
  // Each test article gets its visual from the same router as real stories (§11c). Harbor Point
  // has a fictional street grid and a stand-in geocoder, so CI never calls the Census.
  // Boca's sample guide gets a stand-in stock photo the same way (no Unsplash call in CI).
  const deps =
    town.slug === 'harbor-point'
      ? await seedFictionalBasemap(db, town.id)
      : town.slug === 'boca-raton'
        ? stockStandIn()
        : undefined;
  for (const id of written) await assignArticleImage(db, id, deps);
  // Topics as the entity job would link them (no model call in fixtures).
  for (const { id, streets } of topics) {
    await linkArticleEntities(
      db,
      { id, townId: town.id },
      streets.map((name) => ({ name, kind: 'street' as const, key: entityKey('street', name) })),
    );
  }
}

/** The middle of Harbor Point's fictional street grid (open water off a made-up coast). */
const HARBOR_CENTER: [number, number] = [-68.9, 43.9];

/**
 * A fictional base map for Harbor Point: a few made-up streets around HARBOR_CENTER, plus a
 * geocoder stand-in that answers every lookup with that point. Not OpenStreetMap data.
 */
async function seedFictionalBasemap(db: Db, townId: string): Promise<ImageDeps> {
  const [x, y] = HARBOR_CENTER;
  const lines: Array<{ c: string; n?: string; p: Array<[number, number]> }> = [
    {
      c: 'water',
      p: [
        [x + 0.004, y - 0.01],
        [x + 0.005, y + 0.01],
      ],
    },
    {
      c: 'major',
      n: 'Sample Harbor Road',
      p: [
        [x - 0.01, y],
        [x + 0.004, y],
      ],
    },
    {
      c: 'secondary',
      n: 'Ferry Lane',
      p: [
        [x - 0.0045, y - 0.01],
        [x - 0.0045, y + 0.01],
      ],
    },
    {
      c: 'minor',
      n: 'Mill Street',
      p: [
        [x - 0.01, y + 0.0012],
        [x + 0.004, y + 0.0012],
      ],
    },
    {
      c: 'minor',
      n: 'Pier Street',
      p: [
        [x - 0.01, y - 0.0012],
        [x + 0.004, y - 0.0012],
      ],
    },
  ];
  const values = {
    bbox: [x - 0.15, y - 0.11, x + 0.15, y + 0.11] as [number, number, number, number],
    lines,
    sourceUrl: 'https://example.com/fictional-basemap',
    extractedAt: new Date(),
  };
  await db
    .insert(townBasemaps)
    .values({ townId, ...values })
    .onConflictDoUpdate({ target: townBasemaps.townId, set: values });
  const fetcher = {
    getJson: async () => ({ result: { addressMatches: [{ coordinates: { x, y } }] } }),
  } as unknown as ImageDeps['fetcher'];
  return { fetcher };
}

/**
 * A stand-in for the Unsplash API (search, then the download ping) with one sample photo. The
 * image URL points at Unsplash's image host, as a real one would, but no such photo exists.
 */
function stockStandIn(): ImageDeps {
  const photo = {
    id: 'test-fixture-photo',
    width: 4000,
    height: 2667,
    color: '#c9d6df',
    description: null,
    alt_description: 'Garbage bins lined up at the curb',
    urls: { raw: 'https://images.unsplash.com/photo-test-fixture?ixid=test' },
    links: {
      html: 'https://unsplash.com/photos/test-fixture-photo',
      download_location: 'https://api.unsplash.com/photos/test-fixture-photo/download',
    },
    user: { name: 'Sample Photographer', links: { html: 'https://unsplash.com/@sample' } },
  };
  const fetcher = {
    getJson: async (url: string) => (url.includes('/search/photos') ? { results: [photo] } : {}),
  } as unknown as ImageDeps['fetcher'];
  return { fetcher, unsplash: { accessKey: 'test-fixture' } };
}
