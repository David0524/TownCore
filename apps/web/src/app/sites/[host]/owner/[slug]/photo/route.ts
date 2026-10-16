import { ownerListings } from '@towncore/directory';
import { PhotoRejected, submitPhoto } from '@towncore/photos';
import { db } from '@/lib/db';
import { clientIp } from '@/lib/newsletter';
import { currentOwner, sameOrigin } from '@/lib/owner';
import { photosOpen, photoStorage } from '@/lib/photos';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string; slug: string }> };

// An owner adds a photo of their listing (M9): stored with the business license grant, shown
// once staff approve it with alt text.
export async function POST(request: Request, { params }: Ctx) {
  const { host, slug } = await params;
  const town = await resolveTown(decodeURIComponent(host));
  if (!town) return new Response(null, { status: 404 });
  const email = await currentOwner(town);
  const form = await request.formData().catch(() => null);
  if (!email || !form || !sameOrigin(request))
    return new Response(null, { status: 303, headers: { Location: '/owner' } });
  const listing = (await ownerListings(db(), town.id, email)).find((l) => l.slug === slug);
  if (!listing) return new Response(null, { status: 404 });
  const file = form.get('photo');
  const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array();
  const back = (s: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `/owner/${encodeURIComponent(slug)}?s=${s}#photos` },
    });
  if (!photosOpen()) return back('photo_closed');
  try {
    await submitPhoto(db(), photoStorage(), {
      townId: town.id,
      kind: 'business',
      businessId: listing.id,
      bytes,
      caption: String(form.get('caption') ?? ''),
      credit: String(form.get('credit') ?? ''),
      name: listing.name,
      email,
      agreed: form.get('agree') === 'yes',
      ip: clientIp(request),
    });
  } catch (error) {
    if (error instanceof PhotoRejected) return back(`photo_${error.code}`);
    console.error('owner photo failed', error);
    return back('photo_error');
  }
  return back('photo_sent');
}
