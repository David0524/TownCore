import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Fragment, type ReactNode } from 'react';
import { beats } from '@towncore/config';
import { ListBeacon } from '@/components/Beacon';
import { SectionHeader } from '@/components/news/SectionHeader';
import { StoryBlock } from '@/components/news/StoryBlock';
import { ArticleVisual } from '@/components/visuals/ArticleVisual';
import { beatCoverage, sourceLabel } from '@/content/beats';
import { TownGrid } from '@/layout/TownGrid';
import { themeFor } from '@/lib/theme';
import { requireTown } from '@/lib/town';
import { rankedBeatArticles, roundupFigure, townSources } from '@/modules/data';
import { ComingUp, DocumentsPosted } from '@/modules/front';
import { Slot } from '@/slots/Slot';
import styles from './beat.module.css';

type Props = { params: Promise<{ host: string; beat: string }> };

const INFEED_EVERY = 6;
// Which beats show the city's meeting calendar and its own releases beside their stories.
const MEETING_BEATS = new Set(['government', 'development']);
const POSTING_BEATS = new Set(['government', 'community']);

function findBeat(slug: string) {
  return beats.find((b) => b.slug === slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const beat = findBeat((await params).beat);
  return beat ? { title: beat.label } : {};
}

/**
 * Beat front (docs/plans/M4b.md §4): what the section covers and where its stories come from,
 * the lead story, the rest as briefs with the in-feed slot, and the city's meetings and
 * releases beside them. A sparse section still has something useful to show.
 */
export default async function BeatPage({ params }: Props) {
  const town = await requireTown(params);
  const beat = findBeat((await params).beat);
  if (!beat) notFound();
  const theme = themeFor(town);
  const [articles, ourSources] = await Promise.all([
    rankedBeatArticles(town.id, beat.slug),
    townSources(town.id),
  ]);
  const coverage = beatCoverage[beat.slug];
  const labels = [
    ...new Set(
      ourSources.filter((s) => coverage?.kinds.includes(s.kind)).map((s) => sourceLabel(s)),
    ),
  ];
  const moduleProps = { town, theme, modules: [] };
  const meetings = MEETING_BEATS.has(beat.slug) ? await ComingUp(moduleProps) : null;
  const postings = POSTING_BEATS.has(beat.slug) ? await DocumentsPosted(moduleProps) : null;
  const side: ReactNode[] = [meetings, postings].filter((n) => n !== null);
  const hasRail = theme.layout.grid === 'main-right-rail';

  const [lead, ...rest] = articles;
  const figure = lead ? await roundupFigure(lead) : null;

  return (
    <TownGrid town={town} kind={theme.layout.grid} railModules={hasRail ? side : null}>
      <ListBeacon />
      <header className={styles.masthead}>
        <SectionHeader title={beat.label} as="h1" />
        {coverage ? <p className={styles.covers}>{coverage.covers}</p> : null}
        <p className="meta">
          {labels.length > 0
            ? `Written from ${labels.join(', ')}.`
            : 'We add this section’s sources as they come online.'}
        </p>
        <Link href="/newsletter" className={styles.email}>
          Get {town.name} news in our morning email →
        </Link>
      </header>

      {/* Phones: what's coming up is the most useful thing on a sparse section. */}
      {hasRail && meetings ? <div className="mobile-only">{meetings}</div> : null}

      {lead ? (
        <>
          <StoryBlock
            story={lead}
            town={town}
            variant="lead"
            as="h2"
            visual={<ArticleVisual town={town} theme={theme} article={lead} figure={figure} />}
          />
          {rest.length > 0 ? (
            <ul className={styles.list}>
              {rest.map((article, i) => (
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
          ) : null}
        </>
      ) : (
        <p className={styles.empty}>No {beat.label.toLowerCase()} stories yet.</p>
      )}

      {hasRail ? null : side}
      {hasRail ? null : <Slot town={town} name="rail.box" />}
    </TownGrid>
  );
}
