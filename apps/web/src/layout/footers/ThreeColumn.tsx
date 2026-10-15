import Link from 'next/link';
import { townContactEmail, type TownConfig } from '@towncore/config';
import { aboutItems, beatItems } from '../navs/items';
import type { PartProps } from '../types';
import styles from './footers.module.css';

export function ThreeColumn({ town }: PartProps) {
  const contact = townContactEmail(town.config as TownConfig);
  return (
    <footer className={styles.footer} data-part="footer:three-column">
      <div className={styles.inner}>
        <div className={styles.columns}>
          <section>
            <h2>{town.siteName}</h2>
            <p>Local news for {town.name}, written from public records.</p>
            <ul className={styles.list}>
              {aboutItems.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2>Sections</h2>
            <ul className={styles.list}>
              {beatItems.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2>Contact</h2>
            <p>
              News tips and corrections:{' '}
              <a href={`mailto:${contact}`} data-testid="contact-email">
                {contact}
              </a>
            </p>
          </section>
        </div>
        <div className={styles.signoff}>
          <p className={styles.wordmark} aria-hidden="true">
            {town.siteName}
          </p>
          <p className={styles.copyright}>
            © {new Date().getFullYear()} {town.siteName}
          </p>
        </div>
      </div>
    </footer>
  );
}
