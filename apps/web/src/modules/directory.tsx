import Link from 'next/link';
import { categoryCounts, claimedListings, listingPlace, newFoodPlaces } from '@towncore/directory';
import { businessPhotoFor, photoPath } from '@towncore/photos/queries';
import { apDate } from '@towncore/pipeline';
import { SectionHeader } from '@/components/news/SectionHeader';
import { db } from '@/lib/db';
import { directoryPath, listingPath } from '@/lib/directory';
import { Slot } from '@/slots/Slot';
import type { HomeModuleComponent } from './types';
import styles from './front.module.css';

// Directory modules for the homepage (M6 PR B; CLAUDE.md §11a-2, docs/plans/M4b.md). Each hides
// itself when the town has no listings. Sponsored content sits in its labeled slot and never
// changes which listings appear or their order (Rule 6).

/** `home.directory`: up to 3 sponsored businesses in the slot, then recently claimed listings. */
export const DirectoryFeatured: HomeModuleComponent = async ({ town }) => {
  const counts = await categoryCounts(db(), town.id);
  if (counts.length === 0) return null;
  const total = counts.reduce((n, c) => n + c.count, 0);
  const claimed = await claimedListings(db(), town.id);
  return (
    <section
      className={styles.coming}
      aria-labelledby="dir-featured-h"
      data-module="directory-featured"
    >
      <SectionHeader title="Local businesses" href={directoryPath()} id="dir-featured-h" />
      <Slot town={town} name="home.directory" />
      {claimed.length > 0 ? (
        <ol className={styles.meetings}>
          {claimed.map((listing) => (
            <li key={listing.id}>
              <Link href={listingPath(listing)} className={styles.meetingTitle}>
                {listing.name}
              </Link>
              <span className={styles.where}>{listingPlace(listing, town.name)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="meta">
        <Link href={directoryPath()}>
          Browse {total.toLocaleString('en-US')} licensed businesses
        </Link>
      </p>
    </section>
  );
};

/** Every category with its count, as buttons. */
export const DirectoryCategories: HomeModuleComponent = async ({ town }) => {
  const counts = await categoryCounts(db(), town.id);
  if (counts.length === 0) return null;
  return (
    <nav aria-label="Local directory" data-module="directory-categories">
      <SectionHeader title="Local directory" href={directoryPath()} />
      <ul className={styles.buttons}>
        {counts.map(({ category, count }) => (
          <li key={category.slug}>
            <Link href={directoryPath(category.slug)} className={styles.button}>
              <span>{category.name}</span>
              <span className="meta">{count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
};

/**
 * Home-service categories as rows with their counts (canvas "Homepage": Find a local pro), with
 * the Top spot slot (an "open Top spot" tile when unsold).
 */
export const FindAPro: HomeModuleComponent = async ({ town }) => {
  const counts = (await categoryCounts(db(), town.id)).filter((c) => c.category.group === 'home');
  if (counts.length === 0) return null;
  return (
    <section className={styles.coming} aria-labelledby="find-pro-h" data-module="find-a-pro">
      <SectionHeader
        title="Find a local pro"
        href={directoryPath()}
        more="Directory"
        id="find-pro-h"
      />
      <Slot town={town} name="directory.topspot" />
      <ul className={styles.rows}>
        {counts.map(({ category, count }) => (
          <li key={category.slug}>
            <Link href={directoryPath(category.slug)} className={styles.row}>
              <span>{category.name}</span>
              <span className="meta">
                {count.toLocaleString('en-US')} <span aria-hidden="true">→</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="meta">Every listing holds an active Florida license.</p>
    </section>
  );
};

/**
 * Places the state newly licensed to serve food (DBPR new establishments), as a grid of cards
 * (canvas "Homepage": New & now open) with the owner's own photo once one is approved, and one
 * sponsored restaurant slot. A license approval is not proof a place has opened, so it says
 * "licensed", not "now open".
 */
export const NewNowOpen: HomeModuleComponent = async ({ town }) => {
  const places = await newFoodPlaces(db(), town.id, { limit: 8 });
  if (places.length === 0) return null;
  const photos = await Promise.all(
    places.map((p) => (p.listing ? businessPhotoFor(db(), p.listing.id) : null)),
  );
  return (
    <section className={styles.coming} aria-labelledby="new-open-h" data-module="new-now-open">
      <SectionHeader title="New places to eat" id="new-open-h" />
      <ol className={styles.cards}>
        {places.map((place, i) => {
          const photo = photos[i];
          const name = place.listing ? (
            <Link href={listingPath(place.listing)} className={styles.cardName}>
              {place.name}
            </Link>
          ) : (
            <span className={styles.cardName}>{place.name}</span>
          );
          return (
            <li key={place.id} className={styles.placeCard}>
              {photo ? (
                <img
                  src={photoPath(photo.id)}
                  alt={photo.alt ?? ''}
                  width={photo.width}
                  height={photo.height}
                  loading="lazy"
                  decoding="async"
                  className={styles.cardPhoto}
                />
              ) : null}
              <span className="meta">Licensed {apDate(place.approvedAt, 'UTC')}</span>
              {name}
              <span className={styles.where}>
                {[place.licenseType, place.zip ? `${town.name} area · ${place.zip}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          );
        })}
      </ol>
      <Slot town={town} name="dining.featured" />
      <p className="meta">From the state&apos;s new food service licenses.</p>
    </section>
  );
};
