import Link from 'next/link';
import type { DirectoryCategory } from '@towncore/config';
import type { Town } from '@towncore/db';
import {
  categoryCuisines,
  categoryListings,
  enhancedListingIds,
  featuredPrices,
  openFeaturedRanks,
  worthALook,
} from '@towncore/directory';
import { CategoryExclusive } from '@/components/directory/DirectoryFrame';
import { OwnerBar } from '@/components/directory/OwnerBar';
import { PlaceCard } from '@/components/directory/PlaceCard';
import places from '@/components/directory/places.module.css';
import { QuoteRequest } from '@/components/directory/QuoteRequest';
import styles from '@/app/sites/[host]/directory/directory.module.css';
import { db } from '@/lib/db';
import { directoryPath, listingDetail, townDay } from '@/lib/directory';
import { FeaturedSpots } from '@/slots/FeaturedSpots';

/** Fewer listings than this on the page is a short list (see shortOnPhones below). */
const SHORT_LIST = 20;

/**
 * One kind of business, the same on its own page and where the directory opens on it
 * (CLAUDE.md §11b "Directory pages"): a sold category sponsorship in the header, paid featured
 * spots in rank order, the unsold ones as one compact strip, then every organic listing in the
 * same order for everyone (verified license, completeness, recently claimed; ties rotate daily),
 * and below them the owner panel and the quote request (owner, 2026-10-17: real businesses
 * within the first screen).
 */
export async function loadCategory(
  town: Town,
  category: DirectoryCategory,
  { q = '', cuisine = '' }: { q?: string; cuisine?: string } = {},
) {
  // Places to eat, shop or visit get ways in beyond A–Z (owner, 2026-10-16): cuisines to browse
  // and a few complete listings worth a look, on the unfiltered page.
  const browsing = category.group !== 'home' && !q && !cuisine;
  const day = townDay(town);
  const [{ listings, total }, enhanced, openRanks, cuisines, picks, prices] = await Promise.all([
    categoryListings(db(), town.id, category.slug, { q, cuisine, day }),
    enhancedListingIds(db(), town.id),
    openFeaturedRanks(db(), town.id, category.slug),
    category.group !== 'home' ? categoryCuisines(db(), town.id, category.slug) : [],
    // Three: one row of the desktop grid.
    browsing ? worthALook(db(), town.id, category.slug, { limit: 3, day }) : [],
    featuredPrices(db(), town, category.slug),
  ]);
  // A short list on a phone would be mostly ads. Unsold house ads in the rail box and the quote
  // slot step aside there (owner decision, 2026-10-16); paid units always show.
  const shortOnPhones = listings.length < SHORT_LIST;
  return {
    category,
    q,
    cuisine,
    listings,
    total,
    enhanced,
    openRanks,
    cuisines,
    picks,
    shortOnPhones,
    prices,
  };
}

export function CategoryView({
  town,
  data,
  quoteStatus,
  waitlistStatus,
}: {
  town: Town;
  data: Awaited<ReturnType<typeof loadCategory>>;
  quoteStatus?: string | undefined;
  waitlistStatus?: string | undefined;
}) {
  const {
    category,
    q,
    cuisine,
    listings,
    total,
    enhanced,
    openRanks,
    cuisines,
    picks,
    shortOnPhones,
    prices,
  } = data;
  return (
    <>
      {/* A sold category sponsorship; unsold, the slot waits in the rail (DirectoryFrame). */}
      <CategoryExclusive town={town} category={category} where="header" />
      <p className={`muted ${styles.intro}`}>
        {category.group === 'home'
          ? `${total} ${total === 1 ? 'business holds' : 'businesses hold'} an active Florida license as ${category.name.toLowerCase()} with a ${town.name} mailing address, which can be outside city limits. Check any license with the state before you hire.`
          : `${total} ${total === 1 ? 'place' : 'places'} in the ${town.name} area${
              category.licenses.length > 0
                ? ', from Florida food service licenses and OpenStreetMap'
                : ', from OpenStreetMap'
            }. An area address can be outside city limits.`}
      </p>
      {cuisines.length > 1 ? (
        <nav aria-label={`Browse ${category.name.toLowerCase()} by cuisine`}>
          <ul className={places.chips} data-testid="cuisines">
            {cuisine ? (
              <li>
                <Link href={directoryPath(category.slug)} className={places.chip}>
                  All
                </Link>
              </li>
            ) : null}
            {cuisines.map((c) => (
              <li key={c.cuisine}>
                <Link
                  href={`${directoryPath(category.slug)}?cuisine=${encodeURIComponent(c.cuisine.toLowerCase())}`}
                  className={places.chip}
                  aria-current={
                    cuisine.toLowerCase() === c.cuisine.toLowerCase() ? 'true' : undefined
                  }
                >
                  {c.cuisine} <span className={places.chipCount}>{c.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <FeaturedSpots town={town} category={category} openRanks={openRanks} prices={prices} />
      {picks.length >= 2 ? (
        <section aria-labelledby="worth-h" data-testid="worth-a-look">
          <h2 id="worth-h" className={places.heading}>
            Worth a look
          </h2>
          <p className="meta">
            A few {category.name.toLowerCase()} with full details, a different cuisine each,
            changing daily. Never paid.
          </p>
          <ul className={places.grid}>
            {picks.map((listing) => (
              <li key={listing.id}>
                <PlaceCard listing={listing} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {listings.length === 0 ? (
        <p data-testid="category-empty">
          {q ? `No ${category.name.toLowerCase()} match “${q}”.` : 'No businesses listed yet.'}
        </p>
      ) : (
        <section aria-labelledby="organic">
          <h2 className={picks.length >= 2 ? places.heading : 'sr-only'} id="organic">
            {q
              ? `Matching “${q}”`
              : cuisine
                ? `${cuisine.charAt(0).toUpperCase()}${cuisine.slice(1)}: ${total.toLocaleString('en-US')} ${category.name.toLowerCase()}`
                : `All ${category.name.toLowerCase()}`}
          </h2>
          <ul className={places.grid}>
            {listings.map((listing) => (
              <li key={listing.id}>
                <PlaceCard
                  listing={listing}
                  label={enhanced.has(listing.id) ? 'Enhanced (paid)' : null}
                  detail={listingDetail(town, listing)}
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
      )}
      <form
        action={directoryPath(category.slug)}
        method="get"
        role="search"
        className={`${styles.search} ${styles.searchAfter}`}
      >
        <label htmlFor="category-q" className="sr-only">
          Search {category.name.toLowerCase()} by name
        </label>
        <input
          id="category-q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder={`Looking for one? Search ${category.name.toLowerCase()} by name`}
          autoComplete="off"
        />
        <button type="submit" className="button">
          Search
        </button>
      </form>
      <OwnerBar
        town={town}
        spots={{
          category,
          openRanks,
          fromCents: openRanks.length ? Math.min(...openRanks.map((r) => prices[r])) : null,
          waitlistStatus,
        }}
      />
      <QuoteRequest
        town={town}
        category={category}
        status={quoteStatus}
        houseOffOnPhones={shortOnPhones}
      />
    </>
  );
}
