import Link from 'next/link';
import { NetworkBadge } from './NetworkBadge';
import styles from './SiteFooter.module.css';

// Rendered by the town layout, so every page carries the network badge (CLAUDE.md rule 1).
export function SiteFooter({ siteName }: { siteName: string }) {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <NetworkBadge />
        <nav aria-label="About this site" className={styles.links}>
          <Link href="/about">About</Link>
          <Link href="/methods">How we report</Link>
          <Link href="/corrections">Corrections</Link>
        </nav>
        <p className={styles.copyright}>
          © {new Date().getFullYear()} {siteName}
        </p>
      </div>
    </footer>
  );
}
