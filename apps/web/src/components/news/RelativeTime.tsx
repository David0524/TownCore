'use client';

import { useEffect, useState } from 'react';

// Pages are cached, so the server renders the absolute time and the browser turns it into
// "2 hrs ago" after loading. A cached page never shows a stale relative time.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeLabel(then: Date, now: Date): string | null {
  const ago = now.getTime() - then.getTime();
  if (ago < 0) return null;
  if (ago < MINUTE) return 'Just now';
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`;
  if (ago < DAY) {
    const hours = Math.floor(ago / HOUR);
    return `${hours} ${hours === 1 ? 'hr' : 'hrs'} ago`;
  }
  if (ago < 2 * DAY) return 'Yesterday';
  if (ago < 7 * DAY) return `${Math.floor(ago / DAY)} days ago`;
  return null;
}

export function RelativeTime({ iso, absolute }: { iso: string; absolute: string }) {
  const [label, setLabel] = useState(absolute);
  useEffect(() => {
    setLabel(relativeLabel(new Date(iso), new Date()) ?? absolute);
  }, [iso, absolute]);
  return (
    <time dateTime={iso} title={absolute}>
      {label}
    </time>
  );
}
