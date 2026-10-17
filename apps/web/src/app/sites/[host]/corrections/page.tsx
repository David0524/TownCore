import type { Metadata } from 'next';
import Link from 'next/link';
import { listTownCorrections } from '@towncore/db';
import { Prose } from '@/components/Prose';
import { correctionsCopy } from '@/content/corrections';
import { fillTemplate } from '@/content/fill';
import { db } from '@/lib/db';
import { StandardPage } from '@/lib/pages';
import { formatTownDate, requireTown } from '@/lib/town';

export const metadata: Metadata = {
  title: 'Corrections',
  alternates: { canonical: '/corrections' },
};

export default async function CorrectionsPage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  const corrections = await listTownCorrections(db(), town.id);
  return (
    <StandardPage town={town}>
      <h1>Corrections</h1>
      <Prose markdown={fillTemplate(correctionsCopy, town)} />
      <h2>Corrections we have made</h2>
      {corrections.length === 0 ? (
        <p>No corrections yet.</p>
      ) : (
        <ul data-testid="corrections-list">
          {corrections.map(({ correction, article }) => (
            <li key={correction.id}>
              <strong>{formatTownDate(correction.createdAt, town)}</strong>:{' '}
              <Link href={`/news/${article.slug}`}>{article.headline}</Link>. {correction.note}
            </li>
          ))}
        </ul>
      )}
    </StandardPage>
  );
}
