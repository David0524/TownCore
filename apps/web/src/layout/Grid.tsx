import type { Theme } from '@towncore/config';
import type { ReactNode } from 'react';
import styles from './Grid.module.css';

export function Grid({
  kind,
  children,
  rail,
  measure = 'normal',
}: {
  kind: Theme['layout']['grid'];
  children: ReactNode;
  rail?: ReactNode;
  measure?: 'normal' | 'wide';
}) {
  if (kind === 'main-right-rail') {
    return (
      <div className={`${styles.grid} ${styles.rail}`} data-part="grid:main-right-rail">
        <main className={styles.main}>{children}</main>
        <aside className={styles.aside} aria-label="More">
          {rail}
        </aside>
      </div>
    );
  }
  return (
    <main
      className={`${styles.grid} ${measure === 'wide' ? styles.wide : styles.single}`}
      data-part="grid:single-column"
    >
      {children}
    </main>
  );
}
