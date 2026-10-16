import { updateOwnedListing } from '@towncore/directory';
import { db } from '@/lib/db';
import { currentOwner, sameOrigin } from '@/lib/owner';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string; slug: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const { host, slug } = await params;
  const town = await resolveTown(decodeURIComponent(host));
  if (!town) return new Response(null, { status: 404 });
  const email = await currentOwner(town);
  const form = await request.formData().catch(() => null);
  if (!email || !form || !sameOrigin(request))
    return new Response(null, { status: 303, headers: { Location: '/owner' } });
  const field = (k: string) => String(form.get(k) ?? '');
  const result = await updateOwnedListing(db(), {
    townId: town.id,
    email,
    slug,
    edit: {
      name: field('name'),
      phone: field('phone'),
      website: field('website'),
      hours: field('hours'),
      serviceArea: field('serviceArea'),
      description: field('description'),
    },
  });
  const query = result.ok
    ? new URLSearchParams({ s: result.nameReview ? 'review' : 'saved' })
    : new URLSearchParams(result.errors.map((e) => ['e', e]));
  return new Response(null, {
    status: 303,
    headers: { Location: `/owner/${encodeURIComponent(slug)}?${query}` },
  });
}
