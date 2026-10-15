'use client';

import { useEffect } from 'react';

// Inbox shortcuts (Mail-3): j / k move between conversations, Enter opens (native link
// behavior), / focuses search. Ignored while typing in a field.
export function KeyboardNav() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === '/') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('input[name="q"]')?.focus();
        return;
      }
      if (event.key !== 'j' && event.key !== 'k') return;
      const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-thread-link]')];
      if (!links.length) return;
      const at = links.indexOf(document.activeElement as HTMLAnchorElement);
      const next = event.key === 'j' ? Math.min(links.length - 1, at + 1) : Math.max(0, at - 1);
      links[at === -1 ? 0 : next]?.focus();
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}

/** In a thread: u goes back to the list. */
export function ThreadKeys({ backHref }: { backHref: string }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === 'u') window.location.assign(backHref);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [backHref]);
  return null;
}
