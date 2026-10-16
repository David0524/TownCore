'use client';

import { useEffect } from 'react';

// Cookieless slot counters (M6 PR E; like the article counters, D-M4-3): each monetization unit
// counts one impression per page view once at least half of it has been on screen, and a click
// when its link is followed. No identifiers and nothing stored on the device; the server only
// keeps daily counts per slot, campaign and business.

type Event = { s: string; k: 'i' | 'c'; c?: string; b?: string };

function describe(el: Element, kind: 'i' | 'c'): Event | null {
  const slot = el.getAttribute('data-slot');
  if (!slot) return null;
  const c = el.getAttribute('data-campaign') ?? undefined;
  const b = el.getAttribute('data-business') ?? undefined;
  return { s: slot, k: kind, ...(c ? { c } : {}), ...(b ? { b } : {}) };
}

export function SlotBeacon() {
  useEffect(() => {
    let queue: Event[] = [];
    const flush = () => {
      if (queue.length === 0) return;
      const body = JSON.stringify({ e: queue.slice(0, 40) });
      queue = [];
      if (!navigator.sendBeacon?.('/s', new Blob([body], { type: 'application/json' }))) {
        void fetch('/s', { method: 'POST', body, keepalive: true }).catch(() => {});
      }
    };
    const timer = setInterval(flush, 5000);
    const seen = new WeakSet<Element>();
    const observer =
      'IntersectionObserver' in window
        ? new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (!entry.isIntersecting || seen.has(entry.target)) continue;
                seen.add(entry.target);
                observer?.unobserve(entry.target);
                const event = describe(entry.target, 'i');
                if (event) queue.push(event);
              }
            },
            { threshold: 0.5 },
          )
        : null;
    for (const el of document.querySelectorAll('[data-slot]')) observer?.observe(el);
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.('[data-slot] a');
      const slot = link?.closest('[data-slot]');
      const event = slot ? describe(slot, 'c') : null;
      if (event) {
        queue.push(event);
        flush();
      }
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('click', onClick);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      flush();
      clearInterval(timer);
      observer?.disconnect();
      document.removeEventListener('click', onClick);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);
  return null;
}
