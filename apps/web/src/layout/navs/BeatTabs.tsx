import Link from 'next/link';
import { beatItems } from './items';
import styles from './navs.module.css';

export function BeatTabs() {
  return (
    <nav aria-label="Sections" data-part="nav:beat-tabs">
      <ul className={styles.tabs}>
        {beatItems.map((item) => (
          <li key={item.href}>
            <Link href={item.href}>{item.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
