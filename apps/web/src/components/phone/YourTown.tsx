'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { PersonIcon, RowChevron } from './icons';
import { readFollow, writeFollow } from './follow';
import styles from './sheet.module.css';

type Beat = { slug: string; label: string; color: string };

/**
 * "Your Boca" (canvas YourBocaSheet): a sheet with a grabber, a centered title and Done, where
 * readers pick the sections they want first and find the morning email. Saved on this device
 * only. The neighborhood picker and storm alerts wait for neighborhood data and push alerts.
 */
export function YourTown({
  townName,
  beats,
  newsletter,
}: {
  townName: string;
  beats: Beat[];
  newsletter: 'open' | 'soon';
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [follow, setFollow] = useState<string[]>([]);
  useEffect(() => setFollow(readFollow()), []);

  const toggle = (slug: string, on: boolean) => {
    const next = on
      ? [...follow.filter((b) => b !== slug), slug]
      : follow.filter((b) => b !== slug);
    setFollow(next);
    writeFollow(next);
  };
  const title = `Your ${townName}`;

  return (
    <>
      <button
        type="button"
        className={styles.open}
        aria-label={title}
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
        data-testid="your-town-button"
      >
        <PersonIcon />
      </button>
      <dialog
        ref={dialog}
        className={styles.sheet}
        aria-labelledby="your-town-h"
        data-testid="your-town-sheet"
        // A tap on the dimmed page behind closes the sheet, as on iOS.
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
      >
        <div className={styles.inner}>
          <span className={styles.grabber} aria-hidden="true" />
          <div className={styles.titleBar}>
            <span />
            <h2 id="your-town-h" className={styles.title}>
              {title}
            </h2>
            <button type="button" className={styles.done} onClick={() => dialog.current?.close()}>
              Done
            </button>
          </div>
          <p className={styles.intro}>
            Choose what comes first. Saved on this device only; no account needed.
          </p>

          <h3 className={styles.groupTitle}>Show me more of</h3>
          <ul className={styles.group}>
            {beats.map((beat) => (
              <li key={beat.slug}>
                <label className={styles.row}>
                  <span
                    className={styles.swatch}
                    style={{ background: beat.color }}
                    aria-hidden="true"
                  />
                  <span className={styles.rowLabel}>{beat.label}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    className={styles.switchInput}
                    checked={follow.includes(beat.slug)}
                    onChange={(e) => toggle(beat.slug, e.target.checked)}
                  />
                  <span className={styles.switch} aria-hidden="true" />
                </label>
              </li>
            ))}
          </ul>
          <p className={styles.groupFooter}>These sections move to the top of Today.</p>

          <h3 className={styles.groupTitle}>Email</h3>
          <ul className={styles.group}>
            <li>
              {newsletter === 'open' ? (
                <Link
                  href="/newsletter"
                  className={styles.row}
                  onClick={() => dialog.current?.close()}
                >
                  <span className={styles.rowLabel}>Morning email</span>
                  <span className={styles.value}>Sign up</span>
                  <span className={styles.chevron}>
                    <RowChevron />
                  </span>
                </Link>
              ) : (
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Morning email</span>
                  <span className={styles.value}>Coming soon</span>
                </div>
              )}
            </li>
          </ul>
        </div>
      </dialog>
    </>
  );
}
