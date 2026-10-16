import type { Metadata } from 'next';
import { listRankableArticles } from '@towncore/db';
import { LargeTitle } from '@/components/phone/LargeTitle';
import styles from '@/components/phone/phone.module.css';
import { StoryBlock } from '@/components/news/StoryBlock';
import { db } from '@/lib/db';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';

// Search results are never indexed.
export const metadata: Metadata = { title: 'Search', robots: { index: false, follow: true } };

const MAX_QUERY = 100;

/** The Search tab: our published stories whose headline or summary has every word searched. */
export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const town = await requireTown(params);
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, MAX_QUERY) ?? '';
  const results = q
    ? await listRankableArticles(db(), town.id, { search: q, limit: 30, guides: true })
    : [];
  return (
    <StandardPage town={town}>
      <LargeTitle title="Search" as="h1" always search={{ defaultValue: q }} />
      {q ? (
        <section aria-live="polite" data-testid="search-results">
          <p className="meta">
            {results.length === 0
              ? `No stories match “${q}”.`
              : `${results.length} ${results.length === 1 ? 'story' : 'stories'} for “${q}”`}
          </p>
          <ul className={styles.results}>
            {results.map((story) => (
              <li key={story.id}>
                <StoryBlock story={story} town={town} variant="list" />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="muted">Search every story {town.siteName} has published.</p>
      )}
    </StandardPage>
  );
}
