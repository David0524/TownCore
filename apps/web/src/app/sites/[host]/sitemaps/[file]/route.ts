import { beats } from '@towncore/config';
import {
  articlePath,
  isIndexable,
  listListedArticles,
  siteUrl,
  urlset,
  xmlResponse,
} from '@/lib/discovery';
import { listPublishedGuides, listTownCorrections } from '@towncore/db';
import { db } from '@/lib/db';
import { MIN_INDEXABLE_STORIES } from '@/lib/indexing';
import { resolveTown } from '@/lib/town';
import { indexableTopics, realStoryCounts, weatherPageHasForecast } from '@/modules/data';

// Built per request from the database (never pre-rendered at build time).
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ host: string; file: string }> };

// /sitemaps/pages.xml, /sitemaps/guides.xml and /sitemaps/articles-YYYY-MM.xml
export async function GET(_req: Request, { params }: Ctx) {
  const { host, file } = await params;
  const town = await resolveTown(host);
  if (!town) return new Response('Not found', { status: 404 });

  if (file === 'pages.xml') {
    const counts = await realStoryCounts(town.id);
    // Topic pages only once they're indexable (3+ real stories, D-M4-5).
    const paths = isIndexable(town)
      ? [
          ...(counts.total >= MIN_INDEXABLE_STORIES ? ['/'] : []),
          '/about',
          '/methods',
          // Only once it lists a correction; empty, it's the same text everywhere.
          ...((await listTownCorrections(db(), town.id)).length ? ['/corrections'] : []),
          ...((await listPublishedGuides(db(), town.id)).length ? ['/guides'] : []),
          // The Weather page once it has a forecast to show.
          ...((await weatherPageHasForecast(town.id)) ? ['/weather'] : []),
          // Sections with 3+ real stories only; thinner ones are noindex.
          ...beats
            .filter((b) => (counts.byBeat.get(b.slug) ?? 0) >= MIN_INDEXABLE_STORIES)
            .map((b) => `/beat/${b.slug}`),
          ...(await indexableTopics(town.id)).map((slug) => `/topics/${slug}`),
        ]
      : [];
    return xmlResponse(
      urlset(paths.map((p) => ({ loc: siteUrl(town, p) }))),
      town,
      'application/xml',
    );
  }

  if (file === 'guides.xml') {
    // Evergreen guides (M4 PR F): lastmod is when the guide's text last changed.
    const guides = await listListedArticles(town, { kind: 'guides' });
    return xmlResponse(
      urlset(
        guides.map((g) => ({
          loc: siteUrl(town, articlePath(g.slug, g.kind)),
          lastmod: g.updatedAt,
        })),
      ),
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
