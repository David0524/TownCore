import { Masthead } from '../Masthead';
import type { HeaderProps } from '../types';
import styles from './headers.module.css';

export function LeftLogoInlineNav({ town, theme, nav }: HeaderProps) {
  return (
    <header className={styles.header} data-part="header:left-logo-inline-nav">
      <div className={`${styles.inner} ${styles.inline}`}>
        <Masthead town={town} theme={theme} size="small" />
        {nav}
      </div>
    </header>
  );
}
