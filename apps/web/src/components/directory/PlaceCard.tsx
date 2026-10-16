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
 * and area), and round Call and Website icon buttons, one compact row (owner: "the call and
 * website buttons can sit as icons on the card"). Contact details only for listings whose
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
          {contact && listing.address ? (
            <p className={styles.where}>
              {[listing.address, listing.zip].filter(Boolean).join(', ')}
            </p>
          ) : null}
          {!(contact && listing.address) && detail ? (
            <p className={styles.where}>{detail}</p>
          ) : null}
          {contact && listing.phone ? (
            <p className={`${styles.where} ${styles.deskPhone}`}>{listing.phone}</p>
          ) : null}
        </div>
      </div>
      {contact && (listing.phone || listing.website) ? (
        <div className={styles.actions}>
          {listing.phone ? (
            <CallButton
              slug={listing.slug}
              phone={listing.phone}
              name={listing.name}
              className={styles.iconButton}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M6.6 2.75 4.3 3.4c-.9.25-1.5 1.15-1.35 2.1.95 5.6 5.95 10.6 11.55 11.55.95.15 1.85-.45 2.1-1.35l.65-2.3a1.1 1.1 0 0 0-.6-1.3l-2.55-1.1a1.1 1.1 0 0 0-1.25.3l-.95 1.1a8.6 8.6 0 0 1-4.2-4.2l1.1-.95a1.1 1.1 0 0 0 .3-1.25L8 3.35a1.1 1.1 0 0 0-1.4-.6Z" />
              </svg>
            </CallButton>
          ) : null}
          {listing.website ? (
            <a
              className={styles.iconButton}
              href={listing.website}
              rel="noopener nofollow"
              aria-label={`${listing.name} website`}
              title="Website"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="10" cy="10" r="7.25" />
                <path d="M2.75 10h14.5M10 2.75c2 2 3 4.4 3 7.25s-1 5.25-3 7.25c-2-2-3-4.4-3-7.25s1-5.25 3-7.25Z" />
              </svg>
            </a>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
