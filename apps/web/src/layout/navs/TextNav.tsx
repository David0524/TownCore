import Link from 'next/link';
import { beats } from '@towncore/config';
import { beatColorVar } from '@/lib/theme';
import styles from './navs.module.css';

/**
 * text-nav: every section as text in equal columns divided by hairlines, each with its square
 * category mark (heritage). On narrow screens it scrolls sideways inside itself.
 */
export function TextNav() {
  return (
    <nav aria-label="Sections" data-part="nav:text-nav">
      <ul className={styles.textNav}>
        {beats.map((beat) => (
          <li key={beat.slug}>
            <Link href={`/beat/${beat.slug}`}>
              <span
                className={styles.mark}
                style={{ background: beatColorVar(beat.slug) }}
                aria-hidden="true"
              />
              {beat.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
