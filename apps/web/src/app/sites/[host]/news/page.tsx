import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment } from 'react';
import { beats } from '@towncore/config';
import { ListBeacon } from '@/components/Beacon';
import { SectionHeader } from '@/components/news/SectionHeader';
import { StoryBlock } from '@/components/news/StoryBlock';
import { TownGrid } from '@/layout/TownGrid';
import { thinUnless } from '@/lib/indexing';
import { themeFor } from '@/lib/theme';
import { requireTown, resolveTown } from '@/lib/town';
import { beatCounts, realStoryCounts, recentArticles } from '@/modules/data';
import { Slot } from '@/slots/Slot';
import styles from '../beat/[beat]/beat.module.css';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ host: string }>;
}): Promise<Metadata> {
  const town = await resolveTown((await params).host);
  if (!town) return {};
  return {
    title: 'News',
    alternates: { canonical: '/news' },
    robots: thinUnless(town, (await realStoryCounts(town.id)).total),
  };
}

const INFEED_EVERY = 6;

/**
 * The News category front (docs/plans/M4b.md, D-M4b-4): every recent story in rank order, with
 * links to the beats that have stories this week.
 */
export default async function NewsPage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  const theme = themeFor(town);
  const [articles, counts] = await Promise.all([recentArticles(town.id), beatCounts(town.id)]);
  const shown = beats.filter((b) => (counts.get(b.slug) ?? 0) > 0);
  return (
    <TownGrid town={town} kind={theme.layout.grid}>
      <ListBeacon />
      <header className={styles.masthead}>
        <SectionHeader title="News" as="h1" />
        {shown.length > 0 ? (
          <p className="meta">
            {shown.map((b, i) => (
              <Fragment key={b.slug}>
                {i > 0 ? ' · ' : ''}
                <Link href={`/beat/${b.slug}`}>{b.label}</Link>
              </Fragment>
            ))}
          </p>
        ) : null}
      </header>
      {articles.length > 0 ? (
        <ul className={styles.list} data-testid="news-list">
          {articles.map((article, i) => (
            <Fragment key={article.id}>
              <li>
                <StoryBlock story={article} town={town} variant="brief" />
              </li>
              {(i + 1) % INFEED_EVERY === 0 ? (
                <li>
                  <Slot town={town} name="home.infeed" />
                </li>
              ) : null}
            </Fragment>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>No stories yet.</p>
      )}
      {theme.layout.grid === 'main-right-rail' ? null : <Slot town={town} name="rail.box" />}
    </TownGrid>
  );
}
