/** The reader's path, without the internal /sites/<host> prefix the proxy rewrites to. */
export function phonePath(pathname: string | null): string {
  return (pathname ?? '/').replace(/^\/sites\/[^/]+/, '') || '/';
}

/** Where a page's back button goes on phones, or null on a tab's own page. */
export function backTarget(path: string): { href: string; label: string } | null {
  if (['/', '/sections', '/events', '/search'].includes(path)) return null;
  if (/^\/(beat|about|methods|corrections|privacy)(\/|$)/.test(path))
    return { href: '/sections', label: 'Sections' };
  return { href: '/', label: 'Today' };
}
