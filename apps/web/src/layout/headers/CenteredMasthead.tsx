import { Masthead } from '../Masthead';
import type { HeaderProps } from '../types';
import styles from './headers.module.css';

export function CenteredMasthead({ town, theme, nav }: HeaderProps) {
  return (
    <header className={styles.header} data-part="header:centered-masthead">
      <div className={`${styles.inner} ${styles.centered}`}>
        <Masthead town={town} theme={theme} size="large" />
        {nav}
      </div>
    </header>
  );
}
