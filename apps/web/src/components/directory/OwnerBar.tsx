import Link from 'next/link';
import type { Town } from '@towncore/db';
import styles from './places.module.css';

/**
 * For business owners (owner, 2026-10-16: "prominent, non-scammy buttons"): what a listing costs
 * (nothing) and the two ways in, claiming a listing or adding a missing business. Plain buttons
 * in the town's colors; no prices, countdowns or urgency.
 */
export function OwnerBar({ town }: { town: Town }) {
  return (
    <section className={styles.owner} aria-labelledby="owner-h" data-testid="owner-bar">
      <div>
        <h2 id="owner-h" className={styles.ownerTitle}>
          Own a business in {town.name}?
        </h2>
        <p className={styles.ownerText}>
          Listings are free. Claim yours to add hours and a description, or add a business
          we&rsquo;re missing.
        </p>
      </div>
      <div className={styles.ownerButtons}>
        <Link href="/directory/claim" className={`${styles.ownerButton} ${styles.primary}`}>
          Claim your listing
        </Link>
        <Link href="/directory/add" className={styles.ownerButton}>
          Add your business
        </Link>
      </div>
    </section>
  );
}
