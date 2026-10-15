import { NextResponse, type NextRequest } from 'next/server';

// Every page is served per town. The proxy only rewrites the path to /sites/<host>/...;
// the layout resolves the host to a town (Next advises against shared state in proxy).
export function proxy(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  const url = request.nextUrl.clone();
  url.pathname = `/sites/${encodeURIComponent(host)}${url.pathname === '/' ? '' : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Skip Next internals and files with an extension (fonts, icons, robots.txt is per-town later).
  matcher: ['/((?!_next/|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)'],
};
