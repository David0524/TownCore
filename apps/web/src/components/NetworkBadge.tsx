import Link from 'next/link';
import { network } from '@towncore/config';
import styles from './NetworkBadge.module.css';

export function NetworkBadge() {
  return (
    <Link href={network.aboutPath} className={styles.badge} data-testid="network-badge">
      <span className={styles.mark} aria-hidden="true">
        TC
      </span>
      <span>
        Part of the <strong>{network.name}</strong> network
      </span>
    </Link>
  );
}
