import Link from 'next/link';
import type { ReactNode } from 'react';
import { RowChevron } from './icons';
import styles from './phone.module.css';

export type GroupRow = {
  key: string;
  label: ReactNode;
  /** Secondary line under the label. */
  detail?: ReactNode;
  /** Leading mark (a category dot). */
  lead?: ReactNode;
  /** Trailing value before the chevron (a count). */
  value?: ReactNode;
  href?: string;
  external?: boolean;
};

/**
 * An inset grouped list (iOS settings style) on phones; plain hairline rows on larger screens.
 * Rows that link carry a disclosure chevron.
 */
export function Grouped({
  title,
  footer,
  rows,
  id,
}: {
  title?: string;
  footer?: ReactNode;
  rows: GroupRow[];
  id?: string;
}) {
  const headingId = title ? (id ?? `group-${title.toLowerCase().replace(/\W+/g, '-')}`) : undefined;
  return (
    <section aria-labelledby={headingId}>
      {title ? (
        <h2 id={headingId} className={styles.groupTitle}>
          {title}
        </h2>
      ) : null}
      <ul className={styles.group}>
        {rows.map((row) => {
          const body = (
            <>
              {row.lead}
              <span className={styles.rowLabel}>
                <span>{row.label}</span>
                {row.detail ? <span className={styles.rowDetail}>{row.detail}</span> : null}
              </span>
              {row.value !== undefined ? (
                <span className={styles.rowDetail}>{row.value}</span>
              ) : null}
              {row.href ? (
                <span className={styles.rowChevron}>
                  <RowChevron />
                </span>
              ) : null}
            </>
          );
          return (
            <li key={row.key}>
              {!row.href ? (
                <div className={styles.row}>{body}</div>
              ) : row.external ? (
                <a href={row.href} rel="nofollow noopener" className={styles.row}>
                  {body}
                </a>
              ) : (
                <Link href={row.href} className={styles.row}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {footer ? <p className={styles.groupFooter}>{footer}</p> : null}
    </section>
  );
}
