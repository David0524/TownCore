import { castVote, PollError } from '@towncore/pipeline';
import { db } from '@/lib/db';
import { clientIp } from '@/lib/newsletter';
import { sameOrigin } from '@/lib/owner';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The quick-poll form posts here (owner, 2026-10-17). One vote per address per poll, kept as a
// keyed hash; a filled honeypot is counted nowhere. With JavaScript the widget asks for JSON;
// without it the reader lands on the poll's results page.
export async function POST(request: Request, { params }: Ctx) {
  const town = await resolveTown(decodeURIComponent((await params).host));
  if (!town) return new Response(null, { status: 404 });
  const json = (request.headers.get('accept') ?? '').includes('application/json');
  const form = await request.formData().catch(() => null);
  const pollId = String(form?.get('poll') ?? '');
  const reply = (status: number, body: Record<string, unknown>) =>
    json
      ? Response.json(body, { status })
      : new Response(null, {
          status: 303,
          headers: { Location: UUID.test(pollId) ? `/poll/${pollId}` : '/' },
        });
  if (!form || !sameOrigin(request) || !UUID.test(pollId)) return reply(400, { outcome: 'error' });
  if (form.get('website')) return reply(400, { outcome: 'error' });
  try {
    const { outcome, results } = await castVote(db(), {
      townId: town.id,
      pollId,
      option: Number(form.get('option')),
      ip: clientIp(request),
    });
    if (!results) return reply(404, { outcome });
    return reply(outcome === 'closed' ? 409 : 200, {
      outcome,
      counts: results.counts,
      total: results.total,
    });
  } catch (error) {
    if (error instanceof PollError) return reply(400, { outcome: 'error' });
    throw error;
  }
}
