import { getPublishedArticle } from '@towncore/db';
import { db } from '@/lib/db';
import { articleOgImage } from '@/lib/og';
import { themeFor } from '@/lib/theme';
import { resolveTown } from '@/lib/town';
import { articleImage } from '@/modules/data';

type Ctx = { params: Promise<{ host: string; slug: string }> };

// The article's share image (1200×630), for Open Graph, X and structured data.
export async function GET(_req: Request, { params }: Ctx) {
  const { host, slug } = await params;
  const town = await resolveTown(host);
  if (!town) return new Response('Not found', { status: 404 });
  const article = await getPublishedArticle(db(), town.id, slug);
  if (!article) return new Response('Not found', { status: 404 });
  const image = await articleImage(article, town.timezone);
  return articleOgImage({ town, theme: themeFor(town), article, image });
}
