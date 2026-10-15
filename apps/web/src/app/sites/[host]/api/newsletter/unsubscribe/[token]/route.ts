import { subscriberForToken, unsubscribeSubscriber } from '@towncore/mail';
import { bulkDeps } from '@/lib/newsletter';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string; token: string }> };

// RFC 8058 one-click unsubscribe: mail clients POST "List-Unsubscribe=One-Click" here with no
// login, and it takes effect at once. The footer page's button posts here too (from=page) and
// goes back to the page.
export async function POST(request: Request, { params }: Ctx) {
  const { host, token } = await params;
  const town = await resolveTown(host);
  const deps = bulkDeps();
  if (!town || !deps) return new Response('Not found', { status: 404 });
  const sub = await subscriberForToken(deps, decodeURIComponent(token));
  if (!sub || sub.townId !== town.id) return new Response('Not found', { status: 404 });
  await unsubscribeSubscriber(deps.db, sub.id);
  const form = await request.formData().catch(() => null);
  if (form?.get('from') === 'page')
    return new Response(null, { status: 303, headers: { Location: `/u/${token}?done=1` } });
  return new Response(`Unsubscribed from ${town.siteName}.`, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function GET(_request: Request, { params }: Ctx) {
  const { token } = await params;
  return new Response(null, { status: 303, headers: { Location: `/u/${token}` } });
}
