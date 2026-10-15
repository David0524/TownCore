import Link from 'next/link';
import { aboutItems, beatItems } from './items';
import styles from './navs.module.css';

export function HamburgerOnly() {
  return (
    <nav aria-label="Sections" data-part="nav:hamburger-only">
      <details className={styles.menu}>
        <summary>
          <span aria-hidden="true">☰</span> Menu
        </summary>
        <ul className={styles.menuList}>
          {[...beatItems, ...aboutItems].map((item) => (
            <li key={item.href}>
              <Link href={item.href}>{item.label}</Link>
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}
