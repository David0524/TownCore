import { directoryProducts, type DirectoryProduct } from '@towncore/config';
import { startCheckout } from '@towncore/directory';
import { db } from '@/lib/db';
import { currentOwner, sameOrigin } from '@/lib/owner';
import { stripe } from '@/lib/stripe';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string; slug: string }> };

// Starts Stripe Checkout for the signed-in owner (D-M6-5: customers pay only through Checkout,
// by their own action). Access is granted later, by the verified webhook only.
export async function POST(request: Request, { params }: Ctx) {
  const { host, slug } = await params;
  const townHost = decodeURIComponent(host);
  const town = await resolveTown(townHost);
  if (!town) return new Response(null, { status: 404 });
  const email = await currentOwner(town);
  const form = await request.formData().catch(() => null);
  const back = (s: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `/owner/${encodeURIComponent(slug)}?s=${s}` },
    });
  if (!email || !form || !sameOrigin(request))
    return new Response(null, { status: 303, headers: { Location: '/owner' } });
  const client = stripe();
  const product = String(form.get('product') ?? '') as DirectoryProduct;
  if (!client || !(product in directoryProducts)) return back('unavailable');
  const proto =
    request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '');
  const result = await startCheckout(db(), client, {
    townId: town.id,
    email,
    slug,
    product,
    origin: `${proto === 'http' ? 'http' : 'https'}://${townHost}`,
  });
  if (result.status === 'redirect')
    return new Response(null, { status: 303, headers: { Location: result.url } });
  if (result.status === 'not_owner')
    return new Response(null, { status: 303, headers: { Location: '/owner' } });
  return back(result.status);
}
