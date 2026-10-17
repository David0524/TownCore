import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { Fragment } from 'react';
import { beats, townContactEmail, type TownConfig } from '@towncore/config';
import {
  getPublishedArticle,
  getRecordSources,
  getSourceRecords,
  listArticleCorrections,
  listArticlesByIds,
  listPublishedGuides,
  type Article,
} from '@towncore/db';
import { ViewBeacon } from '@/components/Beacon';
import { SecondArticleOffer } from '@/components/SecondArticleOffer';
import { RelatedBusinesses } from '@/components/directory/RelatedBusinesses';
import { BeatLabel } from '@/components/news/BeatLabel';
import { MeetingVideo } from '@/components/news/MeetingVideo';
import { ArticleVisual } from '@/components/visuals/ArticleVisual';
import { Prose } from '@/components/Prose';
import { TownGrid } from '@/layout/TownGrid';
import { db } from '@/lib/db';
import { inlineSlotPositions, markdownBlocks } from '@/lib/markdown';
import { themeFor } from '@/lib/theme';
import { formatTownDate, requireTown, resolveTown } from '@/lib/town';
import { Slot } from '@/slots/Slot';
import { articlePath, rssAlternate } from '@/lib/discovery';
import {
  articleImage,
  guideLastChecked,
  firstWithPicture,
  rankedBeatArticles,
  recentArticles,
  roundupFigure,
  storyMeetingVideo,
  storyTopics,
} from '@/modules/data';
import { relatedArticleIds } from '@towncore/pipeline';
import Link from 'next/link';
import { NewsletterCta } from '@/modules/news';
import { SectionHeader } from '@/components/news/SectionHeader';
import { ShareButton } from '@/components/news/ShareButton';
import { SourceList } from '@/components/news/SourceList';
import { StoryBlock } from '@/components/news/StoryBlock';
import { UpNext } from '@/components/news/StoryCards';
import { JsonLd, newsArticleJsonLd } from '@/lib/structured-data';
import styles from './article.module.css';

type Params = Promise<{ host: string; slug: string }>;
/** News stories live under /news; evergreen guides (M4 PR F) under /guides. */
export type ArticleSection = 'news' | 'guides';

const inSection = (article: Pick<Article, 'kind'>, section: ArticleSection) =>
  (article.kind === 'guide') === (section === 'guides');

// Beats whose stories carry the one-agent-per-town real estate sponsor (CLAUDE.md §11b).
const REAL_ESTATE_BEATS = new Set(['development', 'property', 'permits', 'real-estate']);

export async function articleMetadata(params: Params, section: ArticleSection): Promise<Metadata> {
  const { host, slug } = await params;
  const town = await resolveTown(host);
  if (!town) return {};
  const article = await getPublishedArticle(db(), town.id, slug);
  if (!article || !inSection(article, section)) return {};
  const path = articlePath(article.slug, article.kind);
  const image = await articleImage(article, town.timezone);
  const share = { url: `/news/${article.slug}/og`, width: 1200, height: 630, alt: image.alt };
  return {
    title: article.headline,
    description: article.dek ?? undefined,
    alternates: { canonical: path, types: rssAlternate(town) },
    openGraph: {
      type: 'article',
      title: article.headline,
      description: article.dek ?? undefined,
      url: path,
      siteName: town.siteName,
      publishedTime: article.publishedAt?.toISOString(),
      modifiedTime: article.updatedAt.toISOString(),
      section: article.beat,
      images: [share],
    },
    twitter: {
      card: 'summary_large_image',
      title: article.headline,
      description: article.dek ?? undefined,
      images: [share],
    },
    // Test fixtures are never indexable, even on a live town.
    robots: slug.startsWith('test-') ? { index: false, follow: false } : undefined,
  };
}

export async function ArticleView({
  params,
  section,
}: {
  params: Params;
  section: ArticleSection;
}) {
  const town = await requireTown(params);
  const { slug } = await params;
  const article = await getPublishedArticle(db(), town.id, slug);
  if (!article) notFound();
  // One address per article: a guide at /news/<slug> moves to /guides/<slug>, and back.
  if (!inSection(article, section)) permanentRedirect(articlePath(article.slug, article.kind));
  const guide = article.kind === 'guide';
  const path = articlePath(article.slug, article.kind);

  const theme = themeFor(town);
  const template = theme.layout.article;
  const [sourceRecords, corrections, figure, sameBeat, image, topics, relatedIds, checked, guides] =
    await Promise.all([
      getSourceRecords(db(), article.sourceRecordIds),
      listArticleCorrections(db(), article.id),
      roundupFigure(article),
      guide ? [] : rankedBeatArticles(town.id, article.beat),
      articleImage(article, town.timezone),
      storyTopics(article.id),
      guide ? [] : relatedArticleIds(db(), article.id),
      guide ? guideLastChecked(article) : null,
      guide ? listPublishedGuides(db(), town.id) : [],
    ]);
  const recordSources = await getRecordSources(
    db(),
    sourceRecords.map((r) => r.sourceId),
  );
  const otherGuides = guides.filter((g) => g.id !== article.id).slice(0, 6);
  // Up next (owner, 2026-10-16): the most related story, else the top-ranked one; for a guide,
  // another guide. Never this story or a test fixture.
  const ranked = guide ? [] : await recentArticles(town.id);
  const video = guide ? null : await storyMeetingVideo(town.id, town.timezone, sourceRecords);
  // Test fixtures never appear beside real stories.
  const fixture = (a: { slug: string }) =>
    a.slug.startsWith('test-') && !article.slug.startsWith('test-');
  // Related coverage (M4 PR D): follow-ups and stories sharing the most topics.
  const related = (await listArticlesByIds(db(), relatedIds)).filter((a) => !fixture(a));
  // Then up to three more from the same section, none already listed.
  const shown = new Set([article.id, ...related.map((a) => a.id)]);
  // Up next needs a picture, like the lead (owner, 2026-10-17); none rather than a title card.
  const upNext = guide
    ? otherGuides[0]
    : await firstWithPicture(
        [...related, ...ranked]
          .filter((a) => a.id !== article.id && a.kind !== 'guide' && !fixture(a))
          .slice(0, 12),
        town.timezone,
      );
  if (upNext) shown.add(upNext.id);
  const more = sameBeat.filter((a) => !shown.has(a.id) && !fixture(a)).slice(0, 3);
  const beat = beats.find((b) => b.slug === article.beat);
  const blocks = markdownBlocks(article.bodyMd);
  const slotAfter = new Set(inlineSlotPositions(blocks));
  const updated =
    article.publishedAt && article.updatedAt.getTime() - article.publishedAt.getTime() > 60_000
      ? article.updatedAt
      : null;
  const contact = townContactEmail(town.config as TownConfig);
  const reportHref = `mailto:${contact}?subject=${encodeURIComponent(
    `Correction request: ${article.headline}`,
  )}&body=${encodeURIComponent(`Story: https://${town.domain}${path}\n\nWhat's wrong:\n`)}`;

  // wide-reading drops the rail for a generous measure; other templates use the site grid.
  const wide = template === 'wide-reading';
  const grid = wide ? 'single-column' : theme.layout.grid;

  return (
    <TownGrid town={town} kind={grid} measure={wide ? 'wide' : 'normal'}>
      <article data-part={`article:${template}`}>
        <JsonLd data={newsArticleJsonLd(town, article, sourceRecords)} />
        <ViewBeacon slug={article.slug} />
        <header className={styles.header}>
          {beat ? <BeatLabel beat={beat.slug} link /> : null}
          <h1 className={template === 'classic-rail' ? styles.headline : styles.largeHeadline}>
            {article.headline}
          </h1>
          {article.dek ? <p className={styles.dek}>{article.dek}</p> : null}
          <div className={styles.bylineRow}>
            <div>
              <p className={styles.byline} data-testid="byline">
                {article.byline}
              </p>
              {guide ? (
                // Guides: when the text last changed, and when its pages were last checked.
                <p className={`${styles.dates} meta`} data-testid="guide-dates">
                  Updated {formatTownDate(article.updatedAt, town)}
                  {checked ? ` · Last checked ${formatTownDate(checked, town)}` : ''}
                </p>
              ) : (
                <p className={`${styles.dates} meta`}>
                  Published {formatTownDate(article.publishedAt!, town)}
                  {updated ? ` · Updated ${formatTownDate(updated, town)}` : ''}
                </p>
              )}
            </div>
            <ShareButton title={article.headline} url={`https://${town.domain}${path}`} />
          </div>
          {guide ? (
            <p className={styles.guideNote} data-testid="guide-note">
              This guide is written from the official pages listed under Sources. Details such as
              fees, hours and deadlines can change, so check those pages before you act.
            </p>
          ) : null}
        </header>

        {corrections.length > 0 ? (
          <aside className={styles.correction} data-testid="correction-notice">
            {corrections.map((c) => (
              <p key={c.id}>
                <strong>Correction, {formatTownDate(c.createdAt, town)}:</strong> {c.note}
              </p>
            ))}
          </aside>
        ) : null}

        {/* The story's visual (§11c), chosen by the image router. */}
        <figure className={styles.visual}>
          <ArticleVisual town={town} article={article} figure={figure} />
          {image.kind === 'data-graphic' ? (
            <figcaption className={`meta ${styles.visualCaption}`}>
              Counted from this story&apos;s source records, listed below. Chart: {town.siteName}.
            </figcaption>
          ) : null}
          {image.kind === 'map' ? (
            // ODbL: the credit sits with the map, linked to the copyright page.
            <figcaption className={`meta ${styles.visualCaption}`} data-testid="map-credit">
              The marked area shows the block, not an exact address. Map data ©{' '}
              <a href={image.sourceUrl ?? 'https://www.openstreetmap.org/copyright'}>
                OpenStreetMap contributors
              </a>
              .
            </figcaption>
          ) : null}
        </figure>

        {/* No slot may sit between the headline and the first paragraph (§11b). */}
        <div className={styles.body} data-testid="article-body">
          {blocks.map((block, i) => (
            <Fragment key={i}>
              <Prose markdown={block} />
              {slotAfter.has(i) ? <Slot town={town} name="article.inline" /> : null}
            </Fragment>
          ))}
        </div>

        {/* The email offer on a reader's second story (owner, 2026-10-17), shown in their browser. */}
        <SecondArticleOffer town={town} slug={article.slug} />

        {video ? <MeetingVideo {...video} /> : null}

        {REAL_ESTATE_BEATS.has(article.beat) ? (
          <Slot town={town} name="article.realestate" />
        ) : null}

        {topics.length > 0 ? (
          <nav className={styles.topics} aria-label="In this story" data-testid="story-topics">
            <span className="meta">In this story</span>
            <ul>
              {topics.map((t) => (
                <li key={t.slug}>
                  <Link href={`/topics/${t.slug}`}>{t.name}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <SourceList town={town} records={sourceRecords} sources={recordSources} />

        <p className={styles.report}>
          See something wrong?{' '}
          <a href={reportHref} data-testid="report-error">
            Report an error
          </a>
          . {/* Every article links to how stories are made and checked (owner, 2026-10-17). */}
          <a href="/methods" data-testid="how-we-report">
            How we report
          </a>
        </p>

        {upNext ? <UpNext town={town} story={upNext} /> : null}

        {await NewsletterCta({ town, theme, modules: [], placement: 'article' })}

        <RelatedBusinesses town={town} article={article} />

        {related.length > 0 ? (
          <section className={styles.more} aria-labelledby="related-h" data-testid="related">
            <SectionHeader title="Related coverage" id="related-h" />
            <ul className={styles.moreList}>
              {related.map((story) => (
                <li key={story.id}>
                  <StoryBlock story={story} town={town} variant="list" />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {otherGuides.length > 0 ? (
          <section className={styles.more} aria-labelledby="guides-h" data-testid="more-guides">
            <SectionHeader title="More guides" href="/guides" id="guides-h" />
            <ul className={styles.moreList}>
              {otherGuides.map((g) => (
                <li key={g.id}>
                  <Link href={articlePath(g.slug, g.kind)}>{g.headline}</Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {more.length > 0 ? (
          <section className={styles.more} aria-labelledby="more-h">
            <SectionHeader
              title={`More ${beat?.label.toLowerCase() ?? 'news'}`}
              href={beat ? `/beat/${beat.slug}` : '/'}
              id="more-h"
            />
            <ul className={styles.moreList}>
              {more.map((story) => (
                <li key={story.id}>
                  <StoryBlock story={story} town={town} variant="list" />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {grid === 'single-column' ? <Slot town={town} name="rail.box" /> : null}
      </article>
    </TownGrid>
  );
}
