import Link from 'next/link';
import { listPublishedArticles } from '@towncore/db';
import { db } from '@/lib/db';
import { formatTownDate, requireTown } from '@/lib/town';

export default async function HomePage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  const articles = await listPublishedArticles(db(), town.id);

  return (
    <>
      <h1>{town.siteName}</h1>
      <p>
        Local news for {town.name}, written from public records: meetings, permits, filings and
        official releases. <Link href="/methods">How we report</Link>.
      </p>
      <hr className="rule" />
      {articles.length === 0 ? (
        <p>No stories yet. Check back soon.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '1.5rem' }}>
          {articles.map((article) => (
            <li key={article.id}>
              <h2 style={{ fontSize: '1.375rem', marginBottom: '0.25rem' }}>
                <Link href={`/news/${article.slug}`}>{article.headline}</Link>
              </h2>
              {article.dek ? <p style={{ margin: '0 0 0.25rem' }}>{article.dek}</p> : null}
              <p className="muted" style={{ margin: 0 }}>
                {formatTownDate(article.publishedAt!, town)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
