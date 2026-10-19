/** The reader's path, without the internal /sites/<host> prefix the proxy rewrites to. */
export function phonePath(pathname: string | null): string {
  return (pathname ?? '/').replace(/^\/sites\/[^/]+/, '') || '/';
}

/** Where a page's back button goes on phones, or null on a tab's own page. */
export function backTarget(path: string): { href: string; label: string } | null {
  if (['/', '/sections', '/events', '/directory', '/search'].includes(path)) return null;
  // Places: claim and owner pages go back to Places (an owner's edit page to their list),
  // a business to its category, a category to Places.
  if (path.startsWith('/directory/claim/') || path === '/owner')
    return { href: '/directory', label: 'Places' };
  if (path.startsWith('/owner/')) return { href: '/owner', label: 'Back' };
  const place = /^\/directory\/([^/]+)\/[^/]+$/.exec(path);
  if (place) return { href: `/directory/${place[1]}`, label: 'Back' };
  if (path.startsWith('/directory/')) return { href: '/directory', label: 'Places' };
  if (path.startsWith('/events/')) return { href: '/events', label: 'Events' };
  if (/^\/(beat|about|methods|corrections|privacy)(\/|$)/.test(path))
    return { href: '/sections', label: 'Sections' };
  return { href: '/', label: 'Today' };
}
