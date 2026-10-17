import { loadEnv } from '@towncore/config';
import { ownerOptOut } from '@towncore/directory';
import { db } from '@/lib/db';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string; token: string }> };

// RFC 8058 one-click unsubscribe for owner reports and follow-ups: mail clients POST
// "List-Unsubscribe=One-Click" here with no login, and it takes effect at once. The page's button
// posts here too (from=page) and goes back to the page.
export async function POST(request: Request, { params }: Ctx) {
  const { host, token } = await params;
  const town = await resolveTown(decodeURIComponent(host));
  const secret = loadEnv().MAIL_TOKEN_SECRET;
  if (!town || !secret) return new Response('Not found', { status: 404 });
  const business = await ownerOptOut(db(), {
    secret,
    token: decodeURIComponent(token),
    townId: town.id,
  });
  if (!business) return new Response('Not found', { status: 404 });
  const form = await request.formData().catch(() => null);
  if (form?.get('from') === 'page')
    return new Response(null, {
      status: 303,
      headers: { Location: `/owner/stop/${token}?done=1` },
    });
  return new Response(`${town.siteName} won’t send ${business.name} these emails again.`, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function GET(_request: Request, { params }: Ctx) {
  const { token } = await params;
  return new Response(null, { status: 303, headers: { Location: `/owner/stop/${token}` } });
}
