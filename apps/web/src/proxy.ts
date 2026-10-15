import { loadEnv } from '@towncore/config';
import { NextResponse, type NextRequest } from 'next/server';

// Every page is served per town. The proxy only rewrites the path to /sites/<host>/...;
// the layout resolves the host to a town (Next advises against shared state in proxy).
//
// Staff admin (/admin) and the mail webhooks (/api/mail) are served only on the internal host
// from APP_BASE_URL. On a town domain they are rewritten like any other path and 404, so they
// never exist on a site.
export function proxy(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  const url = request.nextUrl.clone();
  if (isAdminHost(host) && /^\/(admin|api\/mail)(\/|$)/.test(url.pathname)) {
    return NextResponse.next();
  }
  url.pathname = `/sites/${encodeURIComponent(host)}${url.pathname === '/' ? '' : url.pathname}`;
  return NextResponse.rewrite(url);
}

function isAdminHost(host: string): boolean {
  const base = loadEnv().APP_BASE_URL;
  return Boolean(base) && new URL(base!).host.toLowerCase() === host.toLowerCase();
}

export const config = {
  // Pages, plus the per-town discovery files (robots.txt, sitemaps, feeds) and app icons and
  // manifest. Skip Next internals and other files with an extension (fonts).
  matcher: [
    '/((?!_next/|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)',
    '/((?!_next/).*\\.(?:xml|txt))',
    '/(apple-touch-icon\\.png|icon-192\\.png|icon-512\\.png|manifest\\.webmanifest)',
  ],
};
