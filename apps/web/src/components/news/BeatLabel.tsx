import { beats } from '@towncore/config';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { beatColorVar } from '@/lib/theme';
import styles from './news.module.css';

/** The beat in sentence case with its category dot (fixed colors network-wide), plus extras. */
export function BeatLabel({
  beat,
  link = false,
  children,
}: {
  beat: string;
  link?: boolean;
  children?: ReactNode;
}) {
  const label = beats.find((b) => b.slug === beat)?.label ?? beat;
  return (
    <p className={`meta ${styles.label}`}>
      <span className={styles.dot} style={{ background: beatColorVar(beat) }} aria-hidden="true" />
      {link ? <Link href={`/beat/${beat}`}>{label}</Link> : label}
      {children ? <> · {children}</> : null}
    </p>
  );
}
