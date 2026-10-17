import Link from 'next/link';
import type { Article, Town } from '@towncore/db';
import { relatedListings } from '@towncore/directory';
import { SectionHeader } from '@/components/news/SectionHeader';
import { db } from '@/lib/db';
import { directoryPath, listingDetail, listingPath, townDay } from '@/lib/directory';
import { Slot } from '@/slots/Slot';
import styles from '@/modules/front.module.css';

/**
 * `article.related-businesses` (CLAUDE.md §11b): the labeled sponsor slot for the story's
 * category, then directory listings: businesses the story names, then licensed businesses in
 * the category matched to its beat. The list is organic; payment only buys the slot above it.
 */
export async function RelatedBusinesses({
  town,
  article,
}: {
  town: Town;
  article: Pick<Article, 'headline' | 'bodyMd' | 'beat'>;
}) {
  const related = await relatedListings(db(), town.id, {
    text: `${article.headline}\n${article.bodyMd}`,
    beat: article.beat,
    day: townDay(town),
  });
  const listings = [...related.named, ...related.listings];
  return (
    <>
      <Slot
        town={town}
        name="article.related-businesses"
        context={related.category ? { category: related.category } : {}}
      />
      {listings.length > 0 ? (
        <section
          className={styles.coming}
          aria-labelledby="related-biz-h"
          data-testid="related-businesses"
        >
          <SectionHeader
            title={
              related.named.length > 0
                ? 'In this story'
                : `Licensed ${related.category?.name.toLowerCase() ?? 'businesses'} in ${town.name}`
            }
            href={related.category ? directoryPath(related.category.slug) : directoryPath()}
            id="related-biz-h"
          />
          <ol className={styles.meetings}>
            {listings.map((listing) => (
              <li key={listing.id}>
                <Link href={listingPath(listing)} className={styles.meetingTitle}>
                  {listing.name}
                </Link>
                <span className={styles.where}>{listingDetail(town, listing)}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}
