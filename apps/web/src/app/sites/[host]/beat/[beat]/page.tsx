import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { beats } from '@towncore/config';
import { ListBeacon } from '@/components/Beacon';
import { StandardPage } from '@/lib/pages';
import { formatTownDate, requireTown } from '@/lib/town';
import { rankedBeatArticles } from '@/modules/data';

type Props = { params: Promise<{ host: string; beat: string }> };

function findBeat(slug: string) {
  return beats.find((b) => b.slug === slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const beat = findBeat((await params).beat);
  return beat ? { title: beat.label } : {};
}

export default async function BeatPage({ params }: Props) {
  const town = await requireTown(params);
  const beat = findBeat((await params).beat);
  if (!beat) notFound();
  const articles = await rankedBeatArticles(town.id, beat.slug);

  return (
    <StandardPage town={town}>
      <ListBeacon />
      <h1>{beat.label}</h1>
      {articles.length === 0 ? (
        <p>No {beat.label.toLowerCase()} stories yet.</p>
      ) : (
        <ul>
          {articles.map((article) => (
            <li key={article.id}>
              <Link href={`/news/${article.slug}`}>{article.headline}</Link>{' '}
              <span className="muted">{formatTownDate(article.publishedAt!, town)}</span>
            </li>
          ))}
        </ul>
      )}
    </StandardPage>
  );
}
