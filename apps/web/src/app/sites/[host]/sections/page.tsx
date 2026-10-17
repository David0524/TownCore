import type { Metadata } from 'next';
import { beats } from '@towncore/config';
import { Grouped } from '@/components/phone/Grouped';
import { LargeTitle } from '@/components/phone/LargeTitle';
import styles from '@/components/phone/phone.module.css';
import { aboutItems } from '@/layout/navs/items';
import { StandardPage } from '@/lib/pages';
import { newsletterOpen } from '@/lib/newsletter';
import { beatColorVar } from '@/lib/theme';
import { requireTown } from '@/lib/town';
import { readerCategories } from '@/modules/categories';
import { beatCounts } from '@/modules/data';
import { THIN_PAGE } from '@/lib/indexing';

export const metadata: Metadata = {
  title: 'Sections',
  alternates: { canonical: '/sections' },
  robots: THIN_PAGE,
};

/** Every section with this week's new stories, then the pages about the paper (the Sections tab). */
export default async function SectionsPage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  const [counts, open, categories] = await Promise.all([
    beatCounts(town.id),
    newsletterOpen(town),
    readerCategories(town),
  ]);
  const sports = categories.find((c) => c.key === 'sports');
  return (
    <StandardPage town={town}>
      <LargeTitle title="Sections" as="h1" always />
      <Grouped
        title="News"
        rows={beats.map((beat) => ({
          key: beat.slug,
          href: `/beat/${beat.slug}`,
          lead: (
            <span
              className={styles.dot}
              style={{ background: beatColorVar(beat.slug) }}
              aria-hidden="true"
            />
          ),
          label: beat.label,
          value: counts.get(beat.slug) ? `${counts.get(beat.slug)} new` : undefined,
        }))}
        footer="New this week."
      />
      {sports ? (
        <Grouped
          title="More"
          rows={[
            {
              key: 'sports',
              href: sports.href,
              lead: (
                <span
                  className={styles.dot}
                  style={{ background: sports.color }}
                  aria-hidden="true"
                />
              ),
              label: sports.name,
              value: sports.count,
            },
          ]}
        />
      ) : null}
      <Grouped
        title={town.siteName}
        rows={[
          ...(open ? [{ key: 'newsletter', href: '/newsletter', label: 'Daily newsletter' }] : []),
          ...aboutItems.map((item) => ({ key: item.href, href: item.href, label: item.label })),
        ]}
      />
    </StandardPage>
  );
}
