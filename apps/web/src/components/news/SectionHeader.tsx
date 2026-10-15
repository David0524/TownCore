import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './news.module.css';

/** A section title in the display face over a 1px ink rule, with an optional "More" link. */
export function SectionHeader({
  title,
  href,
  more = 'More',
  as: Heading = 'h2',
  id,
}: {
  title: ReactNode;
  href?: string;
  more?: string;
  as?: 'h1' | 'h2';
  id?: string;
}) {
  return (
    <div className={styles.sectionHeader}>
      <Heading id={id}>
        {href && Heading === 'h2' ? <Link href={href}>{title}</Link> : title}
      </Heading>
      {href ? (
        <Link href={href} className={`meta ${styles.more}`}>
          {more} →
        </Link>
      ) : null}
    </div>
  );
}
