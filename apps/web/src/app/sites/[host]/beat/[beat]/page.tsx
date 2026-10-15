import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { beats } from '@towncore/config';
import { ListBeacon } from '@/components/Beacon';
import { SectionHeader } from '@/components/news/SectionHeader';
import { StoryBlock } from '@/components/news/StoryBlock';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';
import { rankedBeatArticles } from '@/modules/data';
import styles from './beat.module.css';

type Props = { params: Promise<{ host: string; beat: string }> };

function findBeat(slug: string) {
  return beats.find((b) => b.slug === slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const beat = findBeat((await params).beat);
  return beat ? { title: beat.label } : {};
}

// Beat front, first pass (docs/plans/M4b.md §4): stories as briefs with labels and times. The
// full beat front (coming up, documents posted, filters) is the next redesign step.
export default async function BeatPage({ params }: Props) {
  const town = await requireTown(params);
  const beat = findBeat((await params).beat);
  if (!beat) notFound();
  const articles = await rankedBeatArticles(town.id, beat.slug);

  return (
    <StandardPage town={town}>
      <ListBeacon />
      <SectionHeader title={beat.label} as="h1" />
      {articles.length === 0 ? (
        <p className={styles.empty}>No {beat.label.toLowerCase()} stories yet.</p>
      ) : (
        <ul className={styles.list}>
          {articles.map((article) => (
            <li key={article.id}>
              <StoryBlock story={article} town={town} variant="brief" />
            </li>
          ))}
        </ul>
      )}
    </StandardPage>
  );
}
