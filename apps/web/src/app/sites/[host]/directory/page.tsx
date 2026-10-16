import type { Metadata } from 'next';
import Link from 'next/link';
import { categoryCounts, MIN_INDEXABLE, searchListings } from '@towncore/directory';
import { Grouped } from '@/components/phone/Grouped';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { db } from '@/lib/db';
import { directoryPath, listingDetail, listingPath } from '@/lib/directory';
import { rssAlternate } from '@/lib/discovery';
import { StandardPage } from '@/lib/pages';
import { themeFor } from '@/lib/theme';
import { requireTown } from '@/lib/town';
import styles from './directory.module.css';

type Props = {
  params: Promise<{ host: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
};

const GROUPS = [
  { key: 'home', title: 'Home services' },
  { key: 'food', title: 'Food and drink' },
] as const;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const town = await requireTown(params);
  const { q } = await searchParams;
  const counts = await categoryCounts(db(), town.id);
  const total = counts.reduce((n, c) => n + c.count, 0);
  return {
    title: 'Local directory',
    description: `Licensed businesses in ${town.name}, from Florida's state license records.`,
    alternates: { canonical: '/directory', types: rssAlternate(town) },
    // Search results and a thin directory stay out of search engines (D-M4-5).
    robots: q || total < MIN_INDEXABLE ? { index: false, follow: true } : undefined,
  };
}

/**
 * The Places tab (M6): categories with counts, and a name search. The theme's
 * `layout.directory` decides the shape: tiles (category-grid), the search box first
 * (search-first), or grouped lists (list-map; the map waits for claimed listings, since
 * unclaimed addresses are often homes).
 */
export default async function DirectoryPage({ params, searchParams }: Props) {
  const town = await requireTown(params);
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 80) ?? '';
  const layout = themeFor(town).layout.directory;
  const [counts, results] = await Promise.all([
    categoryCounts(db(), town.id),
    q ? searchListings(db(), town.id, q) : Promise.resolve([]),
  ]);

  const search = (
    <form action="/directory" method="get" role="search" className={styles.search}>
      <label htmlFor="directory-q" className="sr-only">
        Search businesses by name
      </label>
      <input
        id="directory-q"
        name="q"
        type="search"
        defaultValue={q}
        placeholder="Search businesses by name"
        autoComplete="off"
      />
      <button type="submit" className="button">
        Search
      </button>
    </form>
  );

  const categories = GROUPS.map((group) => {
    const items = counts.filter((c) => c.category.group === group.key);
    if (items.length === 0) return null;
    if (layout === 'category-grid') {
      return (
        <section key={group.key} aria-labelledby={`dir-${group.key}`}>
          <h2 id={`dir-${group.key}`}>{group.title}</h2>
          <ul className={styles.grid}>
            {items.map(({ category, count }) => (
              <li key={category.slug}>
                <Link className={styles.tile} href={directoryPath(category.slug)}>
                  <strong>{category.name}</strong>
                  <span className="meta">{count} listed</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      );
    }
    return (
      <Grouped
        key={group.key}
        title={group.title}
        rows={items.map(({ category, count }) => ({
          key: category.slug,
          href: directoryPath(category.slug),
          label: category.name,
          value: String(count),
        }))}
      />
    );
  });

  return (
    <StandardPage town={town}>
      <LargeTitle title="Places" as="h1" always />
      <p className={`muted ${styles.intro}`}>
        Businesses licensed by the State of Florida with a {town.name} address. Listings come from
        the state&apos;s license records; sponsored listings are labeled, and payment never changes
        the order of the rest.
      </p>
      {layout === 'search-first' || q ? search : null}
      {q ? (
        results.length > 0 ? (
          <Grouped
            title={`Businesses matching “${q}”`}
            rows={results.map((listing) => ({
              key: listing.id,
              href: listingPath(listing),
              label: listing.name,
              detail: listingDetail(town, listing),
            }))}
          />
        ) : (
          <p data-testid="directory-no-results">No listed business matches “{q}”.</p>
        )
      ) : null}
      {counts.length === 0 ? (
        <p data-testid="directory-empty">
          The {town.siteName} directory is being built from state license records. Check back soon.
        </p>
      ) : (
        categories
      )}
      {layout !== 'search-first' && !q && counts.length > 0 ? search : null}
    </StandardPage>
  );
}
