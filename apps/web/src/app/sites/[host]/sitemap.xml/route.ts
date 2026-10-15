import { listArticleMonths, siteUrl, sitemapIndex, xmlResponse } from '@/lib/discovery';
import { resolveTown } from '@/lib/town';

// Built per request from the database (never pre-rendered at build time).
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ host: string }> };

// Sitemap index: static pages and beats, then one article sitemap per month.
export async function GET(_req: Request, { params }: Ctx) {
  const town = await resolveTown((await params).host);
  if (!town) return new Response('Not found', { status: 404 });
  const months = await listArticleMonths(town);
  const locations = [
    siteUrl(town, '/sitemaps/pages.xml'),
    ...months.map((m) => siteUrl(town, `/sitemaps/articles-${m}.xml`)),
  ];
  return xmlResponse(sitemapIndex(locations), town, 'application/xml');
}
