import type { Theme } from '@towncore/config';
import type { ReactNode } from 'react';
import styles from './Grid.module.css';

/**
 * The page grid. `top` is a full-width area above the columns (the homepage band); it sits
 * inside <main> so its stories count as page content.
 */
export function Grid({
  kind,
  children,
  rail,
  top,
  measure = 'normal',
}: {
  kind: Theme['layout']['grid'];
  children: ReactNode;
  rail?: ReactNode;
  top?: ReactNode;
  measure?: 'normal' | 'wide';
}) {
  if (kind === 'main-right-rail') {
    return (
      <main className={styles.frame}>
        {top ? <div className={styles.top}>{top}</div> : null}
        <div className={`${styles.grid} ${styles.rail}`} data-part="grid:main-right-rail">
          <div className={styles.main}>{children}</div>
          <aside className={styles.aside} aria-label="More">
            {rail}
          </aside>
        </div>
      </main>
    );
  }
  return (
    <main className={styles.frame}>
      {top ? <div className={styles.top}>{top}</div> : null}
      <div
        className={`${styles.grid} ${measure === 'wide' ? styles.wide : styles.single}`}
        data-part="grid:single-column"
      >
        {children}
      </div>
    </main>
  );
}
