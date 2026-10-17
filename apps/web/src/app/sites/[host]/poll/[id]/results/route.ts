import { eq, polls } from '@towncore/db';
import { pollResults } from '@towncore/pipeline';
import { db } from '@/lib/db';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string; id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An approved poll's counts, for a reader who already voted (the widget remembers it). */
export async function GET(_request: Request, { params }: Ctx) {
  const { host, id } = await params;
  const town = await resolveTown(decodeURIComponent(host));
  if (!town || !UUID.test(id)) return new Response(null, { status: 404 });
  const [poll] = await db().select().from(polls).where(eq(polls.id, id));
  if (!poll || poll.townId !== town.id || poll.status !== 'approved')
    return new Response(null, { status: 404 });
  const { counts, total } = await pollResults(db(), poll);
  return Response.json({ counts, total }, { headers: { 'Cache-Control': 'no-store' } });
}
