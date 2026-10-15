import { countEngagement, type CounterKind } from '@towncore/db';
import { db } from '@/lib/db';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string }> };

// Cookieless engagement counters (D-M4-3): a beacon reports a view, the list impressions on a
// page, or a click from a list. Nothing about the reader is stored: no cookies, no IP address,
// no user agent; only per-article daily counts. Crawlers are not counted.
const KINDS = new Set<CounterKind>(['view', 'impression', 'click']);
const BOT = /bot|crawl|spider|slurp|preview|fetch|headless|lighthouse/i;

export async function POST(request: Request, { params }: Ctx) {
  const town = await resolveTown((await params).host);
  if (!town) return new Response(null, { status: 404 });
  if (BOT.test(request.headers.get('user-agent') ?? '')) return new Response(null, { status: 204 });
  let body: { k?: string; s?: unknown };
  try {
    body = JSON.parse(await request.text());
  } catch {
    return new Response(null, { status: 400 });
  }
  const kind = body.k as CounterKind;
  const slugs = Array.isArray(body.s)
    ? [
        ...new Set(
          body.s.filter((x): x is string => typeof x === 'string' && /^[a-z0-9-]{1,100}$/.test(x)),
        ),
      ]
    : [];
  if (!KINDS.has(kind) || slugs.length === 0) return new Response(null, { status: 400 });
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: town.timezone }).format(new Date());
  await countEngagement(
    db(),
    town.id,
    kind === 'view' || kind === 'click' ? slugs.slice(0, 1) : slugs,
    kind,
    day,
  );
  return new Response(null, { status: 204 });
}
