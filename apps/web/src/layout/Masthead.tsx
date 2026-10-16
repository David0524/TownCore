import { mastheadSvg } from '@towncore/brand';
import { typePairings } from '@towncore/config';
import Link from 'next/link';
import type { PartProps } from './types';
import styles from './Masthead.module.css';

/** The town's generated SVG wordmark (or its logo file, once one exists), linking home. */
export function Masthead({ town, theme, size }: PartProps & { size: 'large' | 'small' | 'slim' }) {
  const logo = (town.config as { logo?: string }).logo;
  return (
    <Link href="/" className={`${styles.masthead} ${styles[size]}`} data-testid="masthead">
      {logo ? (
        // Our own asset; Next's image optimizer isn't needed for an SVG/PNG logo.
        <img src={logo} alt={town.siteName} className={styles.logo} />
      ) : (
        <span
          className={styles.svg}
          dangerouslySetInnerHTML={{
            __html: mastheadSvg({
              siteName: town.siteName,
              style: theme.masthead,
              motif: theme.motif,
              fontFamily: 'var(--font-wordmark)',
              advanceEm: typePairings[theme.type].headlineAdvanceEm,
              fontWeight: typePairings[theme.type].headlineWeight,
            }),
          }}
        />
      )}
    </Link>
  );
}
