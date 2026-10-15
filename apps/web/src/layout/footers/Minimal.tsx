import Link from 'next/link';
import { townContactEmail, type TownConfig } from '@towncore/config';
import { aboutItems } from '../navs/items';
import type { PartProps } from '../types';
import styles from './footers.module.css';

export function Minimal({ town }: PartProps) {
  const contact = townContactEmail(town.config as TownConfig);
  return (
    <footer className={styles.footer} data-part="footer:minimal">
      <div className={`${styles.inner} ${styles.row}`}>
        <a href={`mailto:${contact}`} data-testid="contact-email">
          {contact}
        </a>
        <nav aria-label="About this site" className={styles.links}>
          {aboutItems.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <span>
          © {new Date().getFullYear()} {town.siteName}
        </span>
      </div>
    </footer>
  );
}
