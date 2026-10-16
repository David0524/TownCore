import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { directoryCategory } from '@towncore/config';
import { categoryListings, MIN_INDEXABLE } from '@towncore/directory';
import { Grouped } from '@/components/phone/Grouped';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { db } from '@/lib/db';
import { categoryTitle, directoryPath, listingDetail, listingPath } from '@/lib/directory';
import { rssAlternate } from '@/lib/discovery';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';
import { Slot } from '@/slots/Slot';
import styles from '../directory.module.css';

type Props = {
  params: Promise<{ host: string; category: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
};

const queryOf = (raw: string | string[] | undefined) =>
  (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 80) ?? '';

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const town = await requireTown(params);
  const category = directoryCategory((await params).category);
  if (!category) return {};
  const q = queryOf((await searchParams).q);
  const { total } = await categoryListings(db(), town.id, category.slug, { limit: 0 });
  return {
    title: categoryTitle(town, category),
    description: `${total} licensed ${category.name.toLowerCase()} with a ${town.name} address, from Florida's state license records.`,
    alternates: { canonical: directoryPath(category.slug), types: rssAlternate(town) },
    robots: q || total < MIN_INDEXABLE ? { index: false, follow: true } : undefined,
  };
}

/**
 * A directory category (CLAUDE.md §11b "Directory pages"): the category-exclusive sponsor in
 * the header, the Top spot, sponsored listings, then every organic listing in the same order for
 * everyone (verified license, completeness, recently claimed, name), and the quote request.
 */
export default async function CategoryPage({ params, searchParams }: Props) {
  const town = await requireTown(params);
  const category = directoryCategory((await params).category);
  if (!category) notFound();
  const q = queryOf((await searchParams).q);
  const { listings, total } = await categoryListings(db(), town.id, category.slug, { q });
  const context = { category };

  return (
    <StandardPage town={town}>
      <p className="meta">
        <Link href={directoryPath()}>Places</Link> › {category.name}
      </p>
      <LargeTitle title={categoryTitle(town, category)} as="h1" always />
      <Slot town={town} name="directory.category.exclusive" context={context} />
      <p className={`muted ${styles.intro}`}>
        {category.group === 'food'
          ? `${total} ${total === 1 ? 'place holds' : 'places hold'} an active Florida food service license (${category.name.toLowerCase()}) at a ${town.name} address, which can be outside city limits.`
          : `${total} ${total === 1 ? 'business holds' : 'businesses hold'} an active Florida license as ${category.name.toLowerCase()} with a ${town.name} mailing address, which can be outside city limits. Check any license with the state before you hire.`}
      </p>
      <Slot town={town} name="directory.topspot" context={context} />
      <Slot town={town} name="directory.category.top" context={context} />
      <form method="get" role="search" className={styles.search}>
        <label htmlFor="category-q" className="sr-only">
          Search {category.name.toLowerCase()} by name
        </label>
        <input
          id="category-q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder={`Search ${category.name.toLowerCase()} by name`}
          autoComplete="off"
        />
        <button type="submit" className="button">
          Search
        </button>
      </form>
      {listings.length === 0 ? (
        <p data-testid="category-empty">
          {q ? `No ${category.name.toLowerCase()} match “${q}”.` : 'No businesses listed yet.'}
        </p>
      ) : (
        <Grouped
          title={q ? `Matching “${q}”` : `All ${category.name.toLowerCase()}`}
          id="organic"
          rows={listings.map((listing) => ({
            key: listing.id,
            href: listingPath(listing),
            label: listing.name,
            detail: listingDetail(town, listing),
          }))}
          footer={
            total > listings.length
              ? `Showing ${listings.length} of ${total}. Search by name to find others.`
              : undefined
          }
        />
      )}
      <Slot town={town} name="directory.quote-request" context={context} />
    </StandardPage>
  );
}
