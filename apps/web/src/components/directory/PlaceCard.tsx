import { contactShown, type Listing } from '@towncore/directory';
import { directoryCategory } from '@towncore/config';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { categoryFlavor, listingPath } from '@/lib/directory';
import { CategoryIcon } from './CategoryIcon';
import { CallButton } from './CallButton';
import { foodLook, friendlyName } from './food';
import { FoodDot } from './FoodTile';
import styles from './places.module.css';

/**
 * A place as a card (owner's request, after bocatownsquare.com's "Where to eat"): a colored
 * icon, the name, its cuisine or kind, the street (or, for a license-only listing, its license
 * and area), and Call and Website buttons. Only for listings whose contact
 * details may show (claimed, or a mapped storefront; D-M6-2); the Call tap logs a lead (D-M6-8).
 */
export function PlaceCard({
  listing,
  label,
  detail,
}: {
  listing: Listing;
  label?: string | null;
  /** Shown when the street can't be (a license-only listing): its license and area. */
  detail?: ReactNode;
}) {
  const raw = listing.cuisine ?? directoryCategory(listing.category ?? '')?.singular ?? null;
  const kind = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : null;
  // A license address can be a home: street and contact only when they may show (D-M6-2).
  const contact = contactShown(listing);
  const category = directoryCategory(listing.category ?? '');
  // Places to eat wear their flavor: a small drawn badge from the cuisine (decoration only).
  const look =
    category?.group === 'food'
      ? foodLook({ cuisine: listing.cuisine, name: listing.name, licenseType: listing.licenseType })
      : null;
  return (
    <article className={styles.card} data-testid="place-card">
      {label ? <span className={styles.label}>{label}</span> : null}
      <div className={styles.head}>
        {look ? (
          <FoodDot look={look} />
        ) : (
          <span
            className={styles.dot}
            style={
              {
                '--tint-bg': `var(--food-${categoryFlavor(listing.category ?? '')})`,
                '--tint-ink': `var(--food-${categoryFlavor(listing.category ?? '')}-ink)`,
              } as CSSProperties
            }
            aria-hidden="true"
          >
            <CategoryIcon category={category ?? undefined} />
          </span>
        )}
        <div>
          <h3 className={styles.name}>
            <Link href={listingPath(listing)}>{friendlyName(listing.name)}</Link>
          </h3>
          {kind ? <p className={styles.kind}>{kind}</p> : null}
        </div>
      </div>
      {contact && listing.address ? (
        <p className={styles.where}>
          <svg viewBox="0 0 16 16" aria-hidden="true" className={styles.icon}>
            <path d="M8 14.5s4.75-4.2 4.75-8A4.75 4.75 0 0 0 3.25 6.5c0 3.8 4.75 8 4.75 8Z" />
            <circle cx="8" cy="6.5" r="1.75" />
          </svg>
          {[listing.address, listing.zip].filter(Boolean).join(', ')}
        </p>
      ) : null}
      {!(contact && listing.address) && detail ? <p className={styles.where}>{detail}</p> : null}
      {contact && listing.phone ? <p className={styles.where}>{listing.phone}</p> : null}
      {contact && (listing.phone || listing.website) ? (
        <div className={styles.actions}>
          {listing.phone ? (
            <CallButton
              slug={listing.slug}
              phone={listing.phone}
              name={listing.name}
              label="Call"
              className={`button ${styles.call}`}
            />
          ) : null}
          {listing.website ? (
            <a
              className={`button ${styles.web}`}
              href={listing.website}
              rel="noopener nofollow"
              aria-label={`${listing.name} website`}
            >
              Website
            </a>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
