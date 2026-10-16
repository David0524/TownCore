'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './CategoryBar.module.css';

/** The scrolling row: brings the current kind into view and pages with arrow buttons. */
export function CategoryBarScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ start: true, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const current = el.querySelector<HTMLElement>('[data-current]');
    if (current) el.scrollLeft = current.offsetLeft - (el.clientWidth - current.offsetWidth) / 2;
    const update = () =>
      setEnds({
        start: el.scrollLeft <= 1,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
      });
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  const page = (direction: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <div className={styles.frame}>
      <button
        type="button"
        className={`${styles.arrow} ${styles.prev}`}
        onClick={() => page(-1)}
        hidden={ends.start}
        aria-label="Earlier kinds of business"
      >
        ‹
      </button>
      <div ref={ref} className={styles.scroller}>
        {children}
      </div>
      <button
        type="button"
        className={`${styles.arrow} ${styles.next}`}
        onClick={() => page(1)}
        hidden={ends.end}
        aria-label="More kinds of business"
      >
        ›
      </button>
    </div>
  );
}
