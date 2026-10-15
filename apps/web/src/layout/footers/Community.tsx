import Link from 'next/link';
import { townContactEmail, type TownConfig } from '@towncore/config';
import { aboutItems } from '../navs/items';
import type { PartProps } from '../types';
import styles from './footers.module.css';

/** community footer (§11a-2): a tinted panel with the name, the morning email first, and links. */
export function Community({ town }: PartProps) {
  const contact = townContactEmail(town.config as TownConfig);
  return (
    <footer className={`${styles.footer} ${styles.community}`} data-part="footer:community">
      <div className={styles.inner}>
        <div className={styles.panel}>
          <p className={styles.panelName}>{town.siteName}</p>
          <Link href="/newsletter" className={styles.panelEmail}>
            Get the morning email →
          </Link>
          <nav aria-label="About this site" className={styles.links}>
            {aboutItems.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
          <p className={styles.panelContact}>
            Tips and corrections:{' '}
            <a href={`mailto:${contact}`} data-testid="contact-email">
              {contact}
            </a>{' '}
            · © {new Date().getFullYear()} {town.siteName}
          </p>
        </div>
      </div>
    </footer>
  );
}
