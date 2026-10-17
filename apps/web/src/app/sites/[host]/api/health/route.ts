import { sql } from '@towncore/db';
import { db } from '@/lib/db';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string }> };

// The uptime check's target (Admin → Analytics): answers only when this host serves a known town
// and the database responds, so "up" means readers would see the site. Never cached.
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: Ctx) {
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
  const town = await resolveTown((await params).host);
  if (!town) return Response.json({ ok: false, error: 'unknown host' }, { status: 404, headers });
  try {
    await db().execute(sql`select 1`);
  } catch {
    return Response.json(
      { ok: false, town: town.slug, error: 'database' },
      { status: 503, headers },
    );
  }
  return Response.json({ ok: true, town: town.slug, at: new Date().toISOString() }, { headers });
}
