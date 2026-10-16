import { and, articles, desc, eq, gte, inArray, lt, ne, not, like, type Town } from '@towncore/db';
import { db } from './db';

// Discovery for search engines and readers (CLAUDE.md §11 "SEO"; docs/plans/M4.md §1):
// robots.txt, sitemaps, the Google News sitemap and RSS. Only a live town is ever listed;
// draft and paused towns disallow crawling and list nothing (Rules 7 and 10). Test fixtures
// (slugs starting "test-") are never listed anywhere.

export const NEWS_SITEMAP_HOURS = 48;
export const NEWS_SITEMAP_MAX = 1000;
export const FEED_ITEMS = 30;

export function isIndexable(town: Pick<Town, 'status'>): boolean {
  return town.status === 'live';
}

/** Absolute URL on the town's canonical domain. */
export function siteUrl(town: Pick<Town, 'domain'>, path = '/'): string {
  return `https://${town.domain}${path.startsWith('/') ? path : `/${path}`}`;
}

import { articlePath } from './paths';

export { articlePath };

/**
 * The RSS `<link rel="alternate">`. Next replaces a layout's `alternates` when a page sets its
 * own canonical, so every page that sets one includes this too.
 */
export const rssAlternate = (town: Pick<Town, 'siteName'>) => ({
  'application/rss+xml': [{ url: '/feed.xml', title: town.siteName }],
});

const isPublic = (townId: string) =>
  and(
    eq(articles.townId, townId),
    inArray(articles.status, ['published', 'corrected']),
    not(like(articles.slug, 'test-%')),
  );

export type ListedArticle = {
  slug: string;
  headline: string;
  dek: string | null;
  beat: string;
  publishedAt: Date;
  updatedAt: Date;
  kind: string;
};

const listed = {
  slug: articles.slug,
  headline: articles.headline,
  dek: articles.dek,
  beat: articles.beat,
  publishedAt: articles.publishedAt,
  updatedAt: articles.updatedAt,
  kind: articles.kind,
};

/** Public articles for sitemaps and feeds; empty for a town that isn't live. */
export async function listListedArticles(
  town: Pick<Town, 'id' | 'status'>,
  opts: {
    since?: Date;
    before?: Date;
    beat?: string;
    limit?: number;
    /** News (the default: feeds, news sitemap, monthly sitemaps) or evergreen guides. */
    kind?: 'news' | 'guides';
  } = {},
): Promise<ListedArticle[]> {
  if (!isIndexable(town)) return [];
  const rows = await db()
    .select(listed)
    .from(articles)
    .where(
      and(
        isPublic(town.id),
        opts.since ? gte(articles.publishedAt, opts.since) : undefined,
        opts.before ? lt(articles.publishedAt, opts.before) : undefined,
        opts.beat ? eq(articles.beat, opts.beat) : undefined,
        opts.kind === 'guides' ? eq(articles.kind, 'guide') : ne(articles.kind, 'guide'),
      ),
    )
    .orderBy(desc(articles.publishedAt))
    .limit(opts.limit ?? 50_000);
  return rows.filter((r): r is ListedArticle => r.publishedAt !== null);
}

/** Months ("2026-10") that have public articles, newest first. */
export async function listArticleMonths(town: Pick<Town, 'id' | 'status'>): Promise<string[]> {
  const rows = await listListedArticles(town);
  return [...new Set(rows.map((r) => r.publishedAt.toISOString().slice(0, 7)))];
}

// ---------------------------------------------------------------------------------------------
// XML builders (pure; unit-tested)

export function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';

export function robotsTxt(town: Pick<Town, 'domain' | 'status'>): string {
  if (!isIndexable(town)) {
    // Not live yet: nothing may be crawled or indexed.
    return 'User-agent: *\nDisallow: /\n';
  }
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /api/',
    '',
    `Sitemap: ${siteUrl(town, '/sitemap.xml')}`,
    `Sitemap: ${siteUrl(town, '/news-sitemap.xml')}`,
    '',
  ].join('\n');
}

export function sitemapIndex(locations: string[]): string {
  return (
    XML_HEAD +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    locations.map((loc) => `  <sitemap><loc>${xmlEscape(loc)}</loc></sitemap>\n`).join('') +
    '</sitemapindex>\n'
  );
}

export function urlset(entries: { loc: string; lastmod?: Date }[]): string {
  return (
    XML_HEAD +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries
      .map(
        (e) =>
          `  <url><loc>${xmlEscape(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod.toISOString()}</lastmod>` : ''}</url>\n`,
      )
      .join('') +
    '</urlset>\n'
  );
}

/** Google News sitemap: articles from the last 48 hours, at most 1,000. */
export function newsSitemap(
  town: Pick<Town, 'domain' | 'siteName'>,
  items: ListedArticle[],
  now: Date,
): string {
  const since = now.getTime() - NEWS_SITEMAP_HOURS * 3_600_000;
  const recent = items.filter((a) => a.publishedAt.getTime() >= since).slice(0, NEWS_SITEMAP_MAX);
  return (
    XML_HEAD +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
    'xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n' +
    recent
      .map(
        (a) =>
          `  <url><loc>${xmlEscape(siteUrl(town, articlePath(a.slug)))}</loc><news:news>` +
          `<news:publication><news:name>${xmlEscape(town.siteName)}</news:name>` +
          '<news:language>en</news:language></news:publication>' +
          `<news:publication_date>${a.publishedAt.toISOString()}</news:publication_date>` +
          `<news:title>${xmlEscape(a.headline)}</news:title></news:news></url>\n`,
      )
      .join('') +
    '</urlset>\n'
  );
}

/** RSS 2.0 feed for the site or one beat. */
export function rssFeed(
  town: Pick<Town, 'domain' | 'siteName' | 'name' | 'state'>,
  items: ListedArticle[],
  opts: { title?: string; path?: string; selfPath: string },
): string {
  const title = opts.title ? `${town.siteName}: ${opts.title}` : town.siteName;
  const latest = items[0]?.publishedAt;
  return (
    XML_HEAD +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n' +
    `  <title>${xmlEscape(title)}</title>\n` +
    `  <link>${xmlEscape(siteUrl(town, opts.path ?? '/'))}</link>\n` +
    `  <atom:link href="${xmlEscape(siteUrl(town, opts.selfPath))}" rel="self" type="application/rss+xml"/>\n` +
    `  <description>${xmlEscape(`Local news for ${town.name}, ${town.state}, written from public records.`)}</description>\n` +
    '  <language>en-us</language>\n' +
    (latest ? `  <lastBuildDate>${latest.toUTCString()}</lastBuildDate>\n` : '') +
    items
      .map((a) => {
        const url = siteUrl(town, articlePath(a.slug));
        return (
          '  <item>\n' +
          `    <title>${xmlEscape(a.headline)}</title>\n` +
          `    <link>${xmlEscape(url)}</link>\n` +
          `    <guid isPermaLink="true">${xmlEscape(url)}</guid>\n` +
          `    <pubDate>${a.publishedAt.toUTCString()}</pubDate>\n` +
          `    <category>${xmlEscape(a.beat)}</category>\n` +
          (a.dek ? `    <description>${xmlEscape(a.dek)}</description>\n` : '') +
          '  </item>\n'
        );
      })
      .join('') +
    '</channel>\n</rss>\n'
  );
}

export function xmlResponse(body: string, town: Pick<Town, 'status'>, type: string): Response {
  return new Response(body, {
    headers: {
      'content-type': `${type}; charset=utf-8`,
      'cache-control': 'public, max-age=300',
      ...(isIndexable(town) ? {} : { 'x-robots-tag': 'noindex' }),
    },
  });
}
