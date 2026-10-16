import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Fragment } from 'react';
import { beats, townContactEmail, type TownConfig } from '@towncore/config';
import { getPublishedArticle, getSourceRecords, listArticleCorrections } from '@towncore/db';
import { ViewBeacon } from '@/components/Beacon';
import { RelatedBusinesses } from '@/components/directory/RelatedBusinesses';
import { BeatLabel } from '@/components/news/BeatLabel';
import { ArticleVisual } from '@/components/visuals/ArticleVisual';
import { Prose } from '@/components/Prose';
import { TownGrid } from '@/layout/TownGrid';
import { db } from '@/lib/db';
import { inlineSlotPositions, markdownBlocks } from '@/lib/markdown';
import { themeFor } from '@/lib/theme';
import { formatTownDate, requireTown, resolveTown } from '@/lib/town';
import { Slot } from '@/slots/Slot';
import { rssAlternate } from '@/lib/discovery';
import { articleImage, rankedBeatArticles, roundupFigure } from '@/modules/data';
import { NewsletterCta } from '@/modules/news';
import { SectionHeader } from '@/components/news/SectionHeader';
import { ShareButton } from '@/components/news/ShareButton';
import { StoryBlock } from '@/components/news/StoryBlock';
import { JsonLd, newsArticleJsonLd } from '@/lib/structured-data';
import styles from './article.module.css';

type Props = { params: Promise<{ host: string; slug: string }> };

// Beats whose stories carry the one-agent-per-town real estate sponsor (CLAUDE.md §11b).
const REAL_ESTATE_BEATS = new Set(['development', 'property', 'permits', 'real-estate']);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { host, slug } = await params;
  const town = await resolveTown(host);
  if (!town) return {};
  const article = await getPublishedArticle(db(), town.id, slug);
  if (!article) return {};
  const image = await articleImage(article, town.timezone);
  const share = { url: `/news/${article.slug}/og`, width: 1200, height: 630, alt: image.alt };
  return {
    title: article.headline,
    description: article.dek ?? undefined,
    alternates: { canonical: `/news/${article.slug}`, types: rssAlternate(town) },
    openGraph: {
      type: 'article',
      title: article.headline,
      description: article.dek ?? undefined,
      url: `/news/${article.slug}`,
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

export default async function ArticlePage({ params }: Props) {
  const town = await requireTown(params);
  const { slug } = await params;
  const article = await getPublishedArticle(db(), town.id, slug);
  if (!article) notFound();

  const theme = themeFor(town);
  const template = theme.layout.article;
  const [sourceRecords, corrections, figure, sameBeat, image] = await Promise.all([
    getSourceRecords(db(), article.sourceRecordIds),
    listArticleCorrections(db(), article.id),
    roundupFigure(article),
    rankedBeatArticles(town.id, article.beat),
    articleImage(article, town.timezone),
  ]);
  // Three more from the same section; test fixtures never appear beside real stories.
  const more = sameBeat
    .filter((a) => a.id !== article.id && !a.slug.startsWith('test-'))
    .slice(0, 3);
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
  )}&body=${encodeURIComponent(`Story: https://${town.domain}/news/${article.slug}\n\nWhat's wrong:\n`)}`;

  // wide-reading drops the rail for a generous measure; other templates use the site grid.
  const wide = template === 'wide-reading';
  const grid = wide ? 'single-column' : theme.layout.grid;

  return (
    <TownGrid town={town} kind={grid} measure={wide ? 'wide' : 'normal'}>
      <article data-part={`article:${template}`}>
        <JsonLd data={newsArticleJsonLd(town, article)} />
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
              <p className={`${styles.dates} meta`}>
                Published {formatTownDate(article.publishedAt!, town)}
                {updated ? ` · Updated ${formatTownDate(updated, town)}` : ''}
              </p>
            </div>
            <ShareButton
              title={article.headline}
              url={`https://${town.domain}/news/${article.slug}`}
            />
          </div>
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
          <ArticleVisual town={town} theme={theme} article={article} figure={figure} />
          {image.kind === 'data-graphic' ? (
            <figcaption className={`meta ${styles.visualCaption}`}>
              Counted from this story&apos;s source records, listed below. Chart: {town.siteName}.
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

        {REAL_ESTATE_BEATS.has(article.beat) ? (
          <Slot town={town} name="article.realestate" />
        ) : null}

        <section className={styles.sources} data-testid="sources">
          <h2>Sources</h2>
          {sourceRecords.length === 0 ? (
            <p>Source records are being updated.</p>
          ) : (
            <ol>
              {sourceRecords.map((record) => (
                <li key={record.id}>
                  {record.url ? (
                    <a href={record.url} rel="nofollow noopener" target="_blank">
                      {record.title ?? record.type}
                    </a>
                  ) : (
                    (record.title ?? record.type)
                  )}
                  {record.occurredAt ? ` (${formatTownDate(record.occurredAt, town)})` : ''}
                </li>
              ))}
            </ol>
          )}
        </section>

        <p className={styles.report}>
          See something wrong?{' '}
          <a href={reportHref} data-testid="report-error">
            Report an error
          </a>
          .
        </p>

        {await NewsletterCta({ town, theme, modules: [] })}

        <RelatedBusinesses town={town} article={article} />

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
