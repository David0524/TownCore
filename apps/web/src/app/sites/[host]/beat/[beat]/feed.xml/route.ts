import { beats } from '@towncore/config';
import { FEED_ITEMS, listListedArticles, rssFeed, xmlResponse } from '@/lib/discovery';
import { resolveTown } from '@/lib/town';

// Built per request from the database (never pre-rendered at build time).
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ host: string; beat: string }> };

// RSS for one beat.
export async function GET(_req: Request, { params }: Ctx) {
  const { host, beat: slug } = await params;
  const town = await resolveTown(host);
  const beat = beats.find((b) => b.slug === slug);
  if (!town || !beat) return new Response('Not found', { status: 404 });
  const items = await listListedArticles(town, { beat: beat.slug, limit: FEED_ITEMS });
  return xmlResponse(
    rssFeed(town, items, {
      title: beat.label,
      path: `/beat/${beat.slug}`,
      selfPath: `/beat/${beat.slug}/feed.xml`,
    }),
    town,
    'application/rss+xml',
  );
}
