import { billingPortalUrl } from '@towncore/directory';
import { db } from '@/lib/db';
import { currentOwner, sameOrigin } from '@/lib/owner';
import { stripe } from '@/lib/stripe';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string }> };

// The Stripe Customer Portal: owners change their card or cancel there (D-M6-5).
export async function POST(request: Request, { params }: Ctx) {
  const townHost = decodeURIComponent((await params).host);
  const town = await resolveTown(townHost);
  if (!town) return new Response(null, { status: 404 });
  const email = await currentOwner(town);
  const form = await request.formData().catch(() => null);
  if (!email || !form || !sameOrigin(request))
    return new Response(null, { status: 303, headers: { Location: '/owner' } });
  const slug = encodeURIComponent(String(form.get('slug') ?? ''));
  const client = stripe();
  const proto =
    request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '');
  const url = client
    ? await billingPortalUrl(db(), client, {
        townId: town.id,
        email,
        returnUrl: `${proto === 'http' ? 'http' : 'https'}://${townHost}/owner/${slug}`,
      })
    : null;
  return new Response(null, {
    status: 303,
    headers: { Location: url ?? `/owner/${slug}?s=no_billing` },
  });
}
