import type { Metadata } from 'next';
import { beats } from '@towncore/config';
import { listPublishedGuides } from '@towncore/db';
import Link from 'next/link';
import { SectionHeader } from '@/components/news/SectionHeader';
import { db } from '@/lib/db';
import { articlePath, rssAlternate } from '@/lib/discovery';
import { thinUnless } from '@/lib/indexing';
import { StandardPage } from '@/lib/pages';
import { requireTown, resolveTown } from '@/lib/town';
import styles from './guides.module.css';

type Props = { params: Promise<{ host: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const town = await resolveTown((await params).host);
  if (!town) return {};
  return {
    title: 'Guides',
    description: `${town.siteName} guides to ${town.name} services: trash and recycling, permits, parking, hurricanes, voting and more.`,
    alternates: { canonical: '/guides', types: rssAlternate(town) },
    robots: thinUnless(town, (await listPublishedGuides(db(), town.id)).length, 1),
  };
}

/**
 * Evergreen guides (CLAUDE.md §6a; docs/plans/M4.md §5), grouped by section, A to Z. Each is
 * written from official pages and rewritten when they change.
 */
export default async function GuidesPage({ params }: Props) {
  const town = await requireTown(params);
  const guides = (await listPublishedGuides(db(), town.id)).filter(
    (g) => !g.slug.startsWith('test-') || town.status !== 'live',
  );
  const groups = beats
    .map((beat) => ({ beat, guides: guides.filter((g) => g.beat === beat.slug) }))
    .filter((g) => g.guides.length > 0);
  return (
    <StandardPage town={town}>
      <SectionHeader title="Guides" as="h1" />
      <p className={`muted ${styles.intro}`}>
        How things work in {town.name}, written from official city, county and state pages. Each
        guide links its sources and is updated when they change.
      </p>
      {groups.length === 0 ? (
        <p data-testid="no-guides">Guides are on the way.</p>
      ) : (
        groups.map(({ beat, guides: list }) => (
          <section key={beat.slug} className={styles.group} aria-labelledby={`g-${beat.slug}`}>
            <h2 id={`g-${beat.slug}`} className={styles.groupTitle}>
              {beat.label}
            </h2>
            <ul className={styles.list} data-testid="guide-list">
              {list.map((g) => (
                <li key={g.id}>
                  <Link href={articlePath(g.slug, g.kind)}>{g.headline}</Link>
                  {g.dek ? <p className={`muted ${styles.dek}`}>{g.dek}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </StandardPage>
  );
}
