import { submitSponsorCard } from '@towncore/directory';
import { db } from '@/lib/db';
import { currentOwner, sameOrigin } from '@/lib/owner';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string; slug: string }> };

// The owner submits their sponsor card; it waits for staff before it shows (D-M6-7).
export async function POST(request: Request, { params }: Ctx) {
  const { host, slug } = await params;
  const town = await resolveTown(decodeURIComponent(host));
  if (!town) return new Response(null, { status: 404 });
  const email = await currentOwner(town);
  const form = await request.formData().catch(() => null);
  if (!email || !form || !sameOrigin(request))
    return new Response(null, { status: 303, headers: { Location: '/owner' } });
  const result = await submitSponsorCard(db(), {
    townId: town.id,
    email,
    slug,
    headline: String(form.get('headline') ?? ''),
    body: String(form.get('body') ?? ''),
    placementId: String(form.get('placementId') ?? '') || null,
  });
  const s = result.ok ? 'card_sent' : `card_${result.error}`;
  return new Response(null, {
    status: 303,
    headers: { Location: `/owner/${encodeURIComponent(slug)}?s=${s}#card` },
  });
}
