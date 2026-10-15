import { beats } from '@towncore/config';
import {
  articlePath,
  isIndexable,
  listListedArticles,
  siteUrl,
  urlset,
  xmlResponse,
} from '@/lib/discovery';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string; file: string }> };

// /sitemaps/pages.xml and /sitemaps/articles-YYYY-MM.xml
export async function GET(_req: Request, { params }: Ctx) {
  const { host, file } = await params;
  const town = await resolveTown(host);
  if (!town) return new Response('Not found', { status: 404 });

  if (file === 'pages.xml') {
    const paths = isIndexable(town)
      ? ['/', '/about', '/methods', '/corrections', ...beats.map((b) => `/beat/${b.slug}`)]
      : [];
    return xmlResponse(
      urlset(paths.map((p) => ({ loc: siteUrl(town, p) }))),
      town,
      'application/xml',
    );
  }

  const month = file.match(/^articles-(\d{4})-(\d{2})\.xml$/);
  if (!month) return new Response('Not found', { status: 404 });
  const since = new Date(Date.UTC(+month[1]!, +month[2]! - 1, 1));
  const before = new Date(Date.UTC(+month[1]!, +month[2]!, 1));
  const items = await listListedArticles(town, { since, before });
  return xmlResponse(
    urlset(items.map((a) => ({ loc: siteUrl(town, articlePath(a.slug)), lastmod: a.updatedAt }))),
    town,
    'application/xml',
  );
}
