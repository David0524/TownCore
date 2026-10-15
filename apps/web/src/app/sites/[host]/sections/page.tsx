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
import { beatCounts } from '@/modules/data';

export const metadata: Metadata = { title: 'Sections', alternates: { canonical: '/sections' } };

/** Every section with this week's new stories, then the pages about the paper (the Sections tab). */
export default async function SectionsPage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  const [counts, open] = await Promise.all([beatCounts(town.id), newsletterOpen(town)]);
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
