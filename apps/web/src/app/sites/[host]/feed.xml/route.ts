import { FEED_ITEMS, listListedArticles, rssFeed, xmlResponse } from '@/lib/discovery';
import { resolveTown } from '@/lib/town';

// Built per request from the database (never pre-rendered at build time).
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ host: string }> };

// RSS for the whole site.
export async function GET(_req: Request, { params }: Ctx) {
  const town = await resolveTown((await params).host);
  if (!town) return new Response('Not found', { status: 404 });
  const items = await listListedArticles(town, { limit: FEED_ITEMS });
  return xmlResponse(rssFeed(town, items, { selfPath: '/feed.xml' }), town, 'application/rss+xml');
}
