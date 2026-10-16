import { recordSlotEvents, type SlotEvent } from '@towncore/directory';
import { db } from '@/lib/db';
import { resolveTown } from '@/lib/town';
import { slots } from '@/slots/registry';

type Ctx = { params: Promise<{ host: string }> };

// Slot counters (M6 PR E): impressions and clicks per slot, campaign and business, per day.
// Cookieless: no reader identifiers are read or stored. Crawlers are not counted.
const BOT = /bot|crawl|spider|slurp|preview|fetch|headless|lighthouse/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLOT_NAMES = new Set<string>([...Object.keys(slots), 'directory.business.cta']);

export async function POST(request: Request, { params }: Ctx) {
  const town = await resolveTown((await params).host);
  if (!town) return new Response(null, { status: 404 });
  if (BOT.test(request.headers.get('user-agent') ?? '')) return new Response(null, { status: 204 });
  let body: { e?: unknown };
  try {
    body = JSON.parse((await request.text()).slice(0, 20_000));
  } catch {
    return new Response(null, { status: 400 });
  }
  const events: SlotEvent[] = (Array.isArray(body.e) ? body.e : []).flatMap((raw): SlotEvent[] => {
    const e = raw as { s?: unknown; k?: unknown; c?: unknown; b?: unknown };
    if (typeof e.s !== 'string' || !SLOT_NAMES.has(e.s) || (e.k !== 'i' && e.k !== 'c')) return [];
    const id = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null);
    return [
      {
        slot: e.s,
        kind: e.k === 'i' ? 'impression' : 'click',
        campaignId: id(e.c),
        businessId: id(e.b),
      },
    ];
  });
  if (events.length === 0) return new Response(null, { status: 400 });
  await recordSlotEvents(db(), { townId: town.id, timezone: town.timezone, events });
  return new Response(null, { status: 204 });
}
