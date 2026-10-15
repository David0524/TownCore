'use client';

import { useState } from 'react';
import styles from './news.module.css';

/** Share uses the device's own share sheet (Web Share API); otherwise it copies the link. */
export function ShareButton({ title, url }: { title: string; url: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        // The reader closed the share sheet.
      }
      return;
    }
    await navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button type="button" className={styles.share} onClick={share}>
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M12 3v12M7 8l5-5 5 5M5 13v7h14v-7" />
      </svg>
      <span aria-live="polite">{copied ? 'Link copied' : 'Share'}</span>
    </button>
  );
}
