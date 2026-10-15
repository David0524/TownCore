import Link from 'next/link';
import styles from './SiteHeader.module.css';

export function SiteHeader({ siteName, logo }: { siteName: string; logo?: string | undefined }) {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.wordmark}>
          {logo ? <img src={logo} alt={siteName} className={styles.logo} /> : siteName}
        </Link>
        <nav aria-label="Site" className={styles.nav}>
          <Link href="/">Home</Link>
          <Link href="/about">About</Link>
          <Link href="/methods">Methods</Link>
          <Link href="/corrections">Corrections</Link>
        </nav>
      </div>
    </header>
  );
}
