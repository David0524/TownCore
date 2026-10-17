import { ScoreRejected, submitScore } from '@towncore/pipeline';
import { db } from '@/lib/db';
import { clientIp } from '@/lib/newsletter';
import { sameOrigin } from '@/lib/owner';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string }> };

const back = (status: string) =>
  new Response(null, { status: 303, headers: { Location: `/sports?s=${status}#send-score` } });

// The Sports tab's score form posts here (owner, 2026-10-17): the score waits for an editor's
// approval. A filled honeypot gets the same thanks and stores nothing.
export async function POST(request: Request, { params }: Ctx) {
  const host = decodeURIComponent((await params).host);
  const town = await resolveTown(host);
  if (!town) return new Response(null, { status: 404 });
  if (!sameOrigin(request)) return back('origin');
  const form = await request.formData().catch(() => null);
  if (!form) return back('empty');
  if (String(form.get('website') ?? '')) return back('thanks');
  const text = (name: string) => String(form.get(name) ?? '');
  try {
    await submitScore(db(), {
      townId: town.id,
      sport: text('sport'),
      level: text('level'),
      home: text('home'),
      away: text('away'),
      homeScore: text('homeScore'),
      awayScore: text('awayScore'),
      playedOn: text('playedOn'),
      venue: text('venue'),
      localSide: text('localSide'),
      name: text('name'),
      email: text('email'),
      ip: clientIp(request),
    });
  } catch (error) {
    if (error instanceof ScoreRejected) return back(error.code);
    console.error('score report failed', error);
    return back('error');
  }
  return back('thanks');
}
