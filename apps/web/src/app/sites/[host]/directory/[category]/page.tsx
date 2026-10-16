import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { directoryCategory } from '@towncore/config';
import {
  categoryListings,
  enhancedListingIds,
  MIN_INDEXABLE,
  openFeaturedRanks,
} from '@towncore/directory';
import { PlaceCard } from '@/components/directory/PlaceCard';
import places from '@/components/directory/places.module.css';
import { Grouped } from '@/components/phone/Grouped';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { db } from '@/lib/db';
import { categoryTitle, directoryPath, listingDetail, listingPath } from '@/lib/directory';
import { rssAlternate } from '@/lib/discovery';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';
import { Slot } from '@/slots/Slot';
import { SponsoredCards } from '@/slots/SponsoredCards';
import { QuoteRequest } from '@/components/directory/QuoteRequest';
import styles from '../directory.module.css';

type Props = {
  params: Promise<{ host: string; category: string }>;
  searchParams: Promise<{ q?: string | string[]; quote?: string }>;
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
/** Fewer listings than this on the page is a short list (see shortOnPhones below). */
const SHORT_LIST = 20;

export default async function CategoryPage({ params, searchParams }: Props) {
  const town = await requireTown(params);
  const category = directoryCategory((await params).category);
  if (!category) notFound();
  const { q: rawQ, quote: quoteStatus } = await searchParams;
  const q = queryOf(rawQ);
  const [{ listings, total }, enhanced, openRanks] = await Promise.all([
    categoryListings(db(), town.id, category.slug, { q }),
    enhancedListingIds(db(), town.id),
    openFeaturedRanks(db(), town.id, category.slug),
  ]);
  // House ads offer only the featured spots still open here.
  const context = { category, openRanks };
  // A short list on a phone would be mostly ads: five units stack. Unsold house ads in the rail
  // box, the quote slot and the sponsored cards (which repeat the Top spot's offer) step aside
  // there (owner decision, 2026-10-16); paid units always show.
  const shortOnPhones = listings.length < SHORT_LIST;

  return (
    <StandardPage town={town} shortOnPhones={shortOnPhones}>
      <p className="meta">
        <Link href={directoryPath()}>Places</Link> › {category.name}
      </p>
      <LargeTitle title={categoryTitle(town, category)} as="h1" always />
      <Slot town={town} name="directory.category.exclusive" context={context} />
      <p className={`muted ${styles.intro}`}>
        {category.group === 'home'
          ? `${total} ${total === 1 ? 'business holds' : 'businesses hold'} an active Florida license as ${category.name.toLowerCase()} with a ${town.name} mailing address, which can be outside city limits. Check any license with the state before you hire.`
          : `${total} ${total === 1 ? 'place' : 'places'} in the ${town.name} area${
              category.licenses.length > 0
                ? ', from Florida food service licenses and OpenStreetMap'
                : ', from OpenStreetMap'
            }. An area address can be outside city limits.`}
      </p>
      <Slot town={town} name="directory.topspot" context={context} />
      <SponsoredCards
        town={town}
        category={category}
        openRanks={openRanks}
        houseOffOnPhones={shortOnPhones}
      />
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
      ) : category.group !== 'home' ? (
        <section aria-labelledby="organic">
          <h2 className="sr-only" id="organic">
            {q ? `Matching “${q}”` : `All ${category.name.toLowerCase()}`}
          </h2>
          <ul className={places.grid}>
            {listings.map((listing) => (
              <li key={listing.id}>
                <PlaceCard
                  listing={listing}
                  label={enhanced.has(listing.id) ? 'Enhanced (paid)' : null}
                />
              </li>
            ))}
          </ul>
          {listings.some((l) => l.osmRef) ? (
            <p className={`meta ${places.credit}`} data-testid="osm-credit">
              Places data ©{' '}
              <a href="https://www.openstreetmap.org/copyright" rel="noopener">
                OpenStreetMap contributors
              </a>
              {total > listings.length
                ? `. Showing ${listings.length} of ${total}; search by name to find others.`
                : '.'}
            </p>
          ) : total > listings.length ? (
            <p className="meta">
              Showing {listings.length} of {total}. Search by name to find others.
            </p>
          ) : null}
        </section>
      ) : (
        <Grouped
          title={q ? `Matching “${q}”` : `All ${category.name.toLowerCase()}`}
          id="organic"
          rows={listings.map((listing) => ({
            key: listing.id,
            href: listingPath(listing),
            label: listing.name,
            detail: enhanced.has(listing.id) ? (
              <>
                {listingDetail(town, listing)}
                <br />
                {[listing.phone, listing.hours?.split('\n')[0], listing.description?.slice(0, 120)]
                  .filter(Boolean)
                  .join(' · ')}
              </>
            ) : (
              listingDetail(town, listing)
            ),
            // Paid presentation is labeled; it never changes where the listing sits (Rule 6).
            value: enhanced.has(listing.id) ? 'Enhanced (paid)' : undefined,
          }))}
          footer={
            total > listings.length
              ? `Showing ${listings.length} of ${total}. Search by name to find others.`
              : undefined
          }
        />
      )}
      <QuoteRequest
        town={town}
        category={category}
        status={quoteStatus}
        houseOffOnPhones={shortOnPhones}
      />
    </StandardPage>
  );
}
