import Link from 'next/link';
import { townContactEmail, type TownConfig } from '@towncore/config';
import { readerCategories } from '@/modules/categories';
import { beatItems } from '../navs/items';
import type { PartProps } from '../types';
import styles from './footers.module.css';

/**
 * coastal-modern's footer (canvas "Homepage"): under an ink rule, the site name large with what
 * the paper is and its contact address, then three columns of links: the sections, the pages
 * about the paper, and the ways to take part.
 */
export async function ThreeColumn({ town }: PartProps) {
  const contact = townContactEmail(town.config as TownConfig);
  const categories = await readerCategories(town);
  const sections =
    categories.length > 0
      ? categories.map((c) => ({ href: c.href, label: c.name }))
      : beatItems.slice(1);
  const about = [
    { href: '/about', label: 'About' },
    { href: '/methods', label: 'How we report' },
    { href: '/corrections', label: 'Corrections' },
    { href: '/privacy', label: 'Privacy' },
  ];
  const takePart = [
    { href: '/newsletter', label: 'Morning email' },
    { href: '/guides', label: 'Guides' },
    { href: '/photos', label: 'Send a photo' },
    { href: '/advertise', label: 'Advertise' },
  ];
  const column = (label: string, items: Array<{ href: string; label: string }>) => (
    <nav aria-label={label}>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.href}>
            {item.href.startsWith('mailto:') ? (
              <a href={item.href}>{item.label}</a>
            ) : (
              <Link href={item.href}>{item.label}</Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
  return (
    <footer className={styles.footer} data-part="footer:three-column">
      <div className={styles.inner}>
        <div className={styles.masthead}>
          <div className={styles.about}>
            <p className={styles.wordmark}>{town.siteName}</p>
            <p>{town.name}&apos;s daily paper, from the public record.</p>
            <p>
              News tips and corrections:{' '}
              <a href={`mailto:${contact}`} data-testid="contact-email">
                {contact}
              </a>
            </p>
          </div>
          {column('Sections', sections)}
          {column(`About ${town.siteName}`, about)}
          {column('Take part', takePart)}
        </div>
        <p className={styles.copyright}>
          © {new Date().getFullYear()} {town.siteName}
        </p>
      </div>
    </footer>
  );
}
