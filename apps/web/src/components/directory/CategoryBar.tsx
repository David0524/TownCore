import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { Town } from '@towncore/db';
import { categoryCounts } from '@towncore/directory';
import { db } from '@/lib/db';
import { categoryFlavor, DIRECTORY_GROUPS, directoryPath } from '@/lib/directory';
import { CategoryIcon } from './CategoryIcon';
import { CategoryBarScroll } from './CategoryBarScroll';
import styles from './CategoryBar.module.css';

/**
 * Every kind of business as a row of colored icons (owner, 2026-10-16: the directory should keep
 * the homepage's icons, open on one kind and let readers switch). The current kind is marked and
 * scrolled into view; the arrows page through the row on wide screens, phones swipe.
 */
export async function CategoryBar({ town, active }: { town: Town; active: string }) {
  const counts = await categoryCounts(db(), town.id);
  const ordered = DIRECTORY_GROUPS.flatMap((g) => counts.filter((c) => c.category.group === g.key));
  if (ordered.length < 2) return null;
  return (
    <nav aria-label="Kinds of business" className={styles.bar} data-testid="category-bar">
      <CategoryBarScroll>
        <ul className={styles.row}>
          {ordered.map(({ category, count }, i) => {
            const flavor = categoryFlavor(category.slug);
            const current = category.slug === active;
            const groupStart = i > 0 && ordered[i - 1]!.category.group !== category.group;
            return (
              <li key={category.slug} className={groupStart ? styles.groupStart : undefined}>
                <Link
                  href={directoryPath(category.slug)}
                  className={styles.item}
                  aria-current={current ? 'page' : undefined}
                  data-current={current ? '' : undefined}
                  scroll={false}
                >
                  <span
                    className={styles.round}
                    style={
                      {
                        '--tint-bg': `var(--food-${flavor})`,
                        '--tint-ink': `var(--food-${flavor}-ink)`,
                      } as CSSProperties
                    }
                  >
                    <CategoryIcon category={category} />
                  </span>
                  <span className={styles.name}>{category.name}</span>
                  <span className={styles.count}>
                    {count.toLocaleString('en-US')} {count === 1 ? 'place' : 'places'}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </CategoryBarScroll>
    </nav>
  );
}
