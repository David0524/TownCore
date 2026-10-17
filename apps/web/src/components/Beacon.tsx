'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
// The browser-safe subpath: the package index also loads town files from disk.
import {
  classifyReferral,
  MAX_ENGAGED_SECONDS,
  pageKindOf,
  type ReferralSource,
} from '@towncore/config/audience';

// Sends cookieless engagement counts to /b (D-M4-3). No identifiers, nothing stored on the
// device. `view` on article pages; on list pages, the story links shown (impressions) and any
// click on one of them. A view also carries where it came from as a class (facebook, search,
// newsletter…), worked out here: the referrer itself never leaves the page.

function post(payload: object) {
  const body = JSON.stringify(payload);
  if (!navigator.sendBeacon?.('/b', new Blob([body], { type: 'application/json' }))) {
    void fetch('/b', { method: 'POST', body, keepalive: true }).catch(() => {});
  }
}

function send(kind: 'view' | 'impression' | 'click', slugs: string[], from?: ReferralSource) {
  if (slugs.length === 0) return;
  post(from ? { k: kind, s: slugs, r: from } : { k: kind, s: slugs });
}

/**
 * Every town page: one page view by kind of page, then, when the reader leaves (another page,
 * a closed tab, the app switched), the seconds the page was visible. Time while the tab is hidden
 * doesn't count, and a visit counts at most MAX_ENGAGED_SECONDS.
 */
export function PageBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    const kind = pageKindOf(pathname);
    const slug = kind === 'article' ? pathname.split('/')[2] : undefined;
    post({ k: 'page', p: kind });
    let visibleMs = 0;
    let since = document.visibilityState === 'visible' ? performance.now() : null;
    let sent = false;
    const pause = () => {
      if (since !== null) visibleMs += performance.now() - since;
      since = null;
    };
    const flush = () => {
      pause();
      if (sent) return;
      const t = Math.min(Math.round(visibleMs / 1000), MAX_ENGAGED_SECONDS);
      if (t < 1) return;
      sent = true;
      post(slug ? { k: 'time', p: kind, s: slug, t } : { k: 'time', p: kind, t });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
      else if (!sent) since = performance.now();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      // A client-side navigation to another page ends this visit.
      flush();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [pathname]);
  return null;
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
