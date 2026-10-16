import { logCall } from '@towncore/directory';
import { db } from '@/lib/db';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string }> };

const BOT = /bot|crawl|spider|slurp|preview|fetch|headless|lighthouse/i;

// A tap on a listing's call button, logged as a `call` lead (D-M6-8). Nothing about the reader
// is stored.
export async function POST(request: Request, { params }: Ctx) {
  const town = await resolveTown((await params).host);
  if (!town) return new Response(null, { status: 404 });
  if (BOT.test(request.headers.get('user-agent') ?? '')) return new Response(null, { status: 204 });
  let slug: unknown;
  try {
    slug = (JSON.parse((await request.text()).slice(0, 1000)) as { slug?: unknown }).slug;
  } catch {
    return new Response(null, { status: 400 });
  }
  if (typeof slug !== 'string' || !/^[a-z0-9-]{1,120}$/.test(slug))
    return new Response(null, { status: 400 });
  const logged = await logCall(db(), { townId: town.id, timezone: town.timezone, slug });
  return new Response(null, { status: logged ? 204 : 404 });
}
