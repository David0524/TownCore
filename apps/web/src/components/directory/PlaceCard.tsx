import { contactShown, type Listing } from '@towncore/directory';
import { directoryCategory } from '@towncore/config';
import Link from 'next/link';
import { listingPath } from '@/lib/directory';
import { CallButton } from './CallButton';
import styles from './places.module.css';

/**
 * A place as a card (owner's request, after bocatownsquare.com's "Where to eat"): the name, its
 * cuisine or kind, the street, and Call and Website buttons. Only for listings whose contact
 * details may show (claimed, or a mapped storefront; D-M6-2); the Call tap logs a lead (D-M6-8).
 */
export function PlaceCard({ listing, label }: { listing: Listing; label?: string | null }) {
  const raw = listing.cuisine ?? directoryCategory(listing.category ?? '')?.singular ?? null;
  const kind = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : null;
  // A license address can be a home: street and contact only when they may show (D-M6-2).
  const contact = contactShown(listing);
  return (
    <article className={styles.card} data-testid="place-card">
      {label ? <span className={styles.label}>{label}</span> : null}
      <h3 className={styles.name}>
        <Link href={listingPath(listing)}>{listing.name}</Link>
      </h3>
      {kind ? <p className={styles.kind}>{kind}</p> : null}
      {contact && listing.address ? (
        <p className={styles.where}>
          <svg viewBox="0 0 16 16" aria-hidden="true" className={styles.icon}>
            <path d="M8 14.5s4.75-4.2 4.75-8A4.75 4.75 0 0 0 3.25 6.5c0 3.8 4.75 8 4.75 8Z" />
            <circle cx="8" cy="6.5" r="1.75" />
          </svg>
          {[listing.address, listing.zip].filter(Boolean).join(', ')}
        </p>
      ) : null}
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
