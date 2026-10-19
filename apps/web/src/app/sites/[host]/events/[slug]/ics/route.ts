import { siteUrl } from '@/lib/discovery';
import { eventDescription, eventIdPrefix, eventSlug } from '@/lib/events';
import { eventIcs, icsFilename } from '@/lib/ics';
import { resolveTown } from '@/lib/town';
import { eventByIdPrefix } from '@/modules/data';

// "Add to calendar" (RFC 5545) for one event page. Built per request from the database.
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ host: string; slug: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { host, slug } = await params;
  const town = await resolveTown(host);
  const prefix = eventIdPrefix(slug);
  const event = town && prefix ? await eventByIdPrefix(town.id, town.name, prefix) : null;
  if (!town || !event) return new Response('Not found', { status: 404 });
  const ownSlug = eventSlug(event, town.timezone);
  const body = eventIcs(
    {
      id: event.id,
      title: event.title,
      start: event.when,
      end: event.end,
      allDay: event.allDay,
      location: [event.venue, event.street].filter(Boolean).join(', ') || null,
      description: eventDescription(event.description).join('\n\n') || null,
      pageUrl: siteUrl(town, `/events/${ownSlug}`),
    },
    { domain: town.domain, siteName: town.siteName, timeZone: town.timezone },
  );
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${icsFilename(ownSlug)}"`,
      'Cache-Control': 'public, max-age=300',
      // A calendar file is never a search result.
      'X-Robots-Tag': 'noindex',
    },
  });
}
