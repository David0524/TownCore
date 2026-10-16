import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { getListing, listingCategory, listingInTheNews, listingPlace } from '@towncore/directory';
import { listingPhotos, photoPath } from '@towncore/photos/queries';
import { apDate } from '@towncore/pipeline';
import { CallButton } from '@/components/directory/CallButton';
import { Grouped } from '@/components/phone/Grouped';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { db } from '@/lib/db';
import { directoryPath, LICENSE_LOOKUP, listingPath, localBusinessJsonLd } from '@/lib/directory';
import { articlePath, rssAlternate } from '@/lib/discovery';
import { StandardPage } from '@/lib/pages';
import { JsonLd } from '@/lib/structured-data';
import { requireTown } from '@/lib/town';
import styles from '../../directory.module.css';

type Props = { params: Promise<{ host: string; category: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const town = await requireTown(params);
  const listing = await getListing(db(), town.id, (await params).slug);
  if (!listing) return {};
  const category = listingCategory(listing);
  return {
    title: listing.name,
    description: `${listing.name}: ${listing.licenseType ?? category?.singular ?? 'business'} in the ${town.name} area, with its Florida license.`,
    alternates: { canonical: listingPath(listing), types: rssAlternate(town) },
    // An unclaimed listing is only what the state file says: thin, so noindex (D-M4-5).
    robots: listing.claimedAt ? undefined : { index: false, follow: true },
  };
}

/**
 * A business page (CLAUDE.md §11b "Directory pages"): contact once claimed, the "License
 * verified" badge with the state's own lookup, our stories that name the business, the claim
 * button, and the CTA slot. Unclaimed listings never show a street address or phone (D-M6-2).
 */
export default async function BusinessPage({ params }: Props) {
  const town = await requireTown(params);
  const { category: categorySlug, slug } = await params;
  const listing = await getListing(db(), town.id, slug);
  if (!listing) notFound();
  if (listing.category !== categorySlug) permanentRedirect(listingPath(listing));
  const category = listingCategory(listing);
  const news = await listingInTheNews(db(), town.id, listing.name);
  const claimed = Boolean(listing.claimedAt);
  const claimHref = `/directory/claim/${listing.slug}`;
  // The owner's own photos, once staff approved them (M9); a claimed listing only.
  const photos = claimed ? await listingPhotos(db(), listing.id) : [];

  return (
    <StandardPage town={town}>
      <JsonLd data={localBusinessJsonLd(town, listing)} />
      <p className="meta">
        <Link href={directoryPath()}>Places</Link>
        {category ? (
          <>
            {' '}
            › <Link href={directoryPath(category.slug)}>{category.name}</Link>
          </>
        ) : null}
      </p>
      <LargeTitle title={listing.name} as="h1" always />
      {listing.licenseVerified ? (
        <p className={styles.badge} data-testid="license-verified">
          ✓ License verified with the State of Florida
        </p>
      ) : null}
      <dl className={styles.facts}>
        <dt>Type</dt>
        <dd>{listing.licenseType ?? category?.name}</dd>
        <dt>Where</dt>
        <dd data-testid="listing-place">{listingPlace(listing, town.name)}</dd>
        {listing.licenseNumber ? (
          <>
            <dt>License</dt>
            <dd>
              {listing.licenseNumber}
              {listing.licenseExpiresAt
                ? `, active through ${apDate(listing.licenseExpiresAt, 'UTC')}`
                : ''}
              .{' '}
              <a href={LICENSE_LOOKUP} rel="noopener">
                Check it with the state
              </a>
            </dd>
          </>
        ) : null}
        {claimed && listing.phone ? (
          <>
            <dt>Phone</dt>
            <dd>{listing.phone}</dd>
          </>
        ) : null}
        {claimed && listing.website ? (
          <>
            <dt>Website</dt>
            <dd>
              <a href={listing.website} rel="noopener nofollow">
                {listing.website.replace(/^https?:\/\//, '')}
              </a>
            </dd>
          </>
        ) : null}
        {claimed && listing.hours ? (
          <>
            <dt>Hours</dt>
            <dd className={styles.pre}>{listing.hours}</dd>
          </>
        ) : null}
        {claimed && listing.serviceArea ? (
          <>
            <dt>Serves</dt>
            <dd>{listing.serviceArea}</dd>
          </>
        ) : null}
      </dl>
      {photos.length > 0 ? (
        <ul className={styles.photos} data-testid="listing-photos">
          {photos.map((p) => (
            <li key={p.id}>
              <img
                src={photoPath(p.id)}
                width={p.width}
                height={p.height}
                alt={p.alt ?? ''}
                loading="lazy"
                decoding="async"
              />
              <span className="meta">{p.credit}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {claimed && listing.description ? (
        <p className={`${styles.note} ${styles.pre}`} data-testid="listing-description">
          {listing.description}
        </p>
      ) : null}
      <section
        className={styles.cta}
        data-slot="directory.business.cta"
        data-business={listing.id}
        aria-label="Contact"
      >
        {claimed && listing.phone ? (
          <CallButton slug={listing.slug} phone={listing.phone} name={listing.name} />
        ) : null}
        {claimed ? (
          <a className={`button ${styles.secondary}`} href="/owner" data-testid="manage">
            Owner? Manage this listing
          </a>
        ) : (
          <a className={`button ${styles.secondary}`} href={claimHref} data-testid="claim">
            Is this your business? Claim this listing
          </a>
        )}
      </section>
      {news.length > 0 ? (
        <Grouped
          title="In the news"
          rows={news.map((story) => ({
            key: story.slug,
            href: articlePath(story.slug),
            label: story.headline,
            detail: story.publishedAt ? apDate(story.publishedAt, town.timezone) : undefined,
          }))}
        />
      ) : null}
      <p className={`muted ${styles.note}`}>
        This listing comes from the Florida Department of Business and Professional
        Regulation&apos;s license records{claimed ? ' and details added by the business' : ''}. A{' '}
        {town.name} mailing address can be outside city limits.{' '}
        {claimed ? null : 'Contact details appear once the owner claims the listing.'}
      </p>
    </StandardPage>
  );
}
