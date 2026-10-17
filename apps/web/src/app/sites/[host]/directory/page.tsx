import type { Metadata } from 'next';
import Link from 'next/link';
import { MIN_INDEXABLE, searchListings } from '@towncore/directory';
import { CategoryBar } from '@/components/directory/CategoryBar';
import { CategoryView, loadCategory } from '@/components/directory/CategoryView';
import { DirectoryFrame } from '@/components/directory/DirectoryFrame';
import { Grouped } from '@/components/phone/Grouped';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { db } from '@/lib/db';
import {
  categoryTitle,
  defaultCategory,
  directoryPath,
  listingDetail,
  listingPath,
  townCategories,
  townDay,
} from '@/lib/directory';
import { rssAlternate } from '@/lib/discovery';
import { requireTown } from '@/lib/town';
import styles from './directory.module.css';

type Props = {
  params: Promise<{ host: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const town = await requireTown(params);
  const { q } = await searchParams;
  const counts = await townCategories(town);
  const total = counts.reduce((n, c) => n + c.count, 0);
  return {
    title: 'Local directory',
    description: `Restaurants, shops, services and licensed contractors in the ${town.name} area.`,
    alternates: { canonical: '/directory', types: rssAlternate(town) },
    // Search results and a thin directory stay out of search engines (D-M4-5).
    robots: q || total < MIN_INDEXABLE ? { index: false, follow: true } : undefined,
  };
}

/**
 * The Places tab (M6): every kind of business as a bar of colored icons in ranked order, opening
 * on the top-ranked kind with its listings below, so the page is never just a menu (owner,
 * 2026-10-16 and 2026-10-17); picking another kind goes to its page, with the same bar. No
 * search box here (owner: "Don't think there's a need"); `?q=` still searches every listing.
 */
export default async function DirectoryPage({ params, searchParams }: Props) {
  const town = await requireTown(params);
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 80) ?? '';
  const [counts, results] = await Promise.all([
    townCategories(town),
    q ? searchListings(db(), town.id, q, 25, null, { day: townDay(town) }) : Promise.resolve([]),
  ]);
  const opening = q ? null : defaultCategory(counts);
  const data = opening ? await loadCategory(town, opening.category) : null;

  return (
    <DirectoryFrame town={town} category={data?.category} shortOnPhones={data?.shortOnPhones}>
      <LargeTitle title="Places" as="h1" always />
      <p className={`muted ${styles.intro}`}>
        Restaurants, shops and services in the {town.name} area. Sponsored listings are labeled, and
        payment never changes the order of the rest.
      </p>
      {counts.length === 0 ? (
        <p data-testid="directory-empty">
          The {town.siteName} directory is being built. Check back soon.
        </p>
      ) : (
        <CategoryBar town={town} active={opening?.category.slug ?? ''} />
      )}
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
      {data ? (
        <section aria-labelledby="opening-h" data-testid="directory-opening">
          <h2 id="opening-h" className={styles.openingTitle}>
            <Link href={directoryPath(data.category.slug)}>
              {categoryTitle(town, data.category)}
            </Link>
          </h2>
          <CategoryView town={town} data={data} />
        </section>
      ) : null}
    </DirectoryFrame>
  );
}
