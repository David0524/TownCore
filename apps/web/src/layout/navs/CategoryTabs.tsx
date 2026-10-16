import Link from 'next/link';
import type { Town } from '@towncore/db';
import { readerCategories } from '@/modules/categories';
import { beatItems } from './items';
import styles from './navs.module.css';

/**
 * Reader categories as the section links (docs/plans/M4b.md, D-M4b-4): News, Events, Dining,
 * Businesses, Schools, each only once it has content. Before any do, the beats stand in.
 */
export async function CategoryTabs({ town }: { town: Town }) {
  const categories = await readerCategories(town);
  const items =
    categories.length > 0 ? categories.map((c) => ({ href: c.href, label: c.name })) : beatItems;
  return (
    <nav aria-label="Sections" data-part="nav:category-tabs">
      <ul className={`${styles.tabs} ${styles.categories}`}>
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href}>{item.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
