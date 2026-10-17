import { isPageKind, isReferralSource } from '@towncore/config';
import {
  countEngagedTime,
  countEngagement,
  countPageView,
  countReferral,
  type CounterKind,
} from '@towncore/db';
import { db } from '@/lib/db';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string }> };

// Cookieless engagement counters (D-M4-3): a beacon reports a view, the list impressions on a
// page, or a click from a list. Nothing about the reader is stored: no cookies, no IP address,
// no user agent; only per-article daily counts, and per town a daily count of views by referral
// class. Crawlers are not counted. `page` and `time` count every page by kind, and the seconds a
// page stayed visible (Admin → Analytics), with the same rules.
const KINDS = new Set<CounterKind>(['view', 'impression', 'click']);
const BOT = /bot|crawl|spider|slurp|preview|fetch|headless|lighthouse/i;

export async function POST(request: Request, { params }: Ctx) {
  const town = await resolveTown((await params).host);
  if (!town) return new Response(null, { status: 404 });
  if (BOT.test(request.headers.get('user-agent') ?? '')) return new Response(null, { status: 204 });
  let body: { k?: string; s?: unknown; r?: unknown; p?: unknown; t?: unknown };
  try {
    body = JSON.parse(await request.text());
  } catch {
    return new Response(null, { status: 400 });
  }
  const today = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: town.timezone }).format(new Date());
  if (body.k === 'page' || body.k === 'time') {
    if (!isPageKind(body.p)) return new Response(null, { status: 400 });
    if (body.k === 'page') await countPageView(db(), town.id, today(), body.p);
    else {
      if (typeof body.t !== 'number' || !Number.isFinite(body.t))
        return new Response(null, { status: 400 });
      const slug =
        typeof body.s === 'string' && /^[a-z0-9-]{1,100}$/.test(body.s) ? body.s : undefined;
      await countEngagedTime(db(), town.id, today(), body.p, body.t, slug);
    }
    return new Response(null, { status: 204 });
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
  const day = today();
  await countEngagement(
    db(),
    town.id,
    kind === 'view' || kind === 'click' ? slugs.slice(0, 1) : slugs,
    kind,
    day,
  );
  if (kind === 'view' && isReferralSource(body.r)) await countReferral(db(), town.id, day, body.r);
  return new Response(null, { status: 204 });
}
