'use client';

import { useEffect } from 'react';
// The browser-safe subpath: the package index also loads town files from disk.
import { classifyReferral, type ReferralSource } from '@towncore/config/audience';

// Sends cookieless engagement counts to /b (D-M4-3). No identifiers, nothing stored on the
// device. `view` on article pages; on list pages, the story links shown (impressions) and any
// click on one of them. A view also carries where it came from as a class (facebook, search,
// newsletter…), worked out here: the referrer itself never leaves the page.

function send(kind: 'view' | 'impression' | 'click', slugs: string[], from?: ReferralSource) {
  if (slugs.length === 0) return;
  const body = JSON.stringify(from ? { k: kind, s: slugs, r: from } : { k: kind, s: slugs });
  if (!navigator.sendBeacon?.('/b', new Blob([body], { type: 'application/json' }))) {
    void fetch('/b', { method: 'POST', body, keepalive: true }).catch(() => {});
  }
}

const slugOf = (href: string | null) => href?.match(/^\/news\/([a-z0-9-]+)$/)?.[1] ?? null;

export function ViewBeacon({ slug }: { slug: string }) {
  useEffect(
    () =>
      send(
        'view',
        [slug],
        classifyReferral({
          referrer: document.referrer,
          pageHost: location.hostname,
          search: location.search,
        }),
      ),
    [slug],
  );
  return null;
}

export function ListBeacon() {
  useEffect(() => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>('main a[href^="/news/"]')];
    send('impression', [
      ...new Set(links.map((a) => slugOf(a.getAttribute('href'))).filter((s): s is string => !!s)),
    ]);
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('main a[href^="/news/"]');
      const slug = slugOf(link?.getAttribute('href') ?? null);
      if (slug) send('click', [slug]);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
  return null;
}
