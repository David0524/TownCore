import { listListedArticles, NEWS_SITEMAP_HOURS, newsSitemap, xmlResponse } from '@/lib/discovery';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string }> };

// Google News sitemap: the last 48 hours of public articles.
export async function GET(_req: Request, { params }: Ctx) {
  const town = await resolveTown((await params).host);
  if (!town) return new Response('Not found', { status: 404 });
  const now = new Date();
  const items = await listListedArticles(town, {
    since: new Date(now.getTime() - NEWS_SITEMAP_HOURS * 3_600_000),
  });
  return xmlResponse(newsSitemap(town, items, now), town, 'application/xml');
}
