import { submitTestimonial } from '@towncore/directory';
import { db } from '@/lib/db';
import { currentOwner, sameOrigin } from '@/lib/owner';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string; slug: string }> };

// An advertiser's testimonial, with their permission to show it; staff approve it before it
// appears on /advertise (owner, 2026-10-17).
export async function POST(request: Request, { params }: Ctx) {
  const { host, slug } = await params;
  const town = await resolveTown(decodeURIComponent(host));
  if (!town) return new Response(null, { status: 404 });
  const email = await currentOwner(town);
  const form = await request.formData().catch(() => null);
  if (!email || !form || !sameOrigin(request))
    return new Response(null, { status: 303, headers: { Location: '/owner' } });
  const result = await submitTestimonial(db(), {
    townId: town.id,
    email,
    slug,
    quote: String(form.get('quote') ?? ''),
    permission: form.get('permission') === 'yes',
  });
  return new Response(null, {
    status: 303,
    headers: { Location: `/owner/${encodeURIComponent(slug)}?s=quote_${result}#testimonial` },
  });
}
