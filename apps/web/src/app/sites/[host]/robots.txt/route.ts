import { robotsTxt, xmlResponse } from '@/lib/discovery';
import { resolveTown } from '@/lib/town';

// Built per request from the database (never pre-rendered at build time).
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ host: string }> };

// Per-town robots.txt. A town that isn't live disallows everything.
export async function GET(_req: Request, { params }: Ctx) {
  const town = await resolveTown((await params).host);
  if (!town) return new Response('Not found', { status: 404 });
  return xmlResponse(robotsTxt(town), town, 'text/plain');
}
