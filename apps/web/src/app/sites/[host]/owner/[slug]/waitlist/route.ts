import { joinWaitlist, ownerListings } from '@towncore/directory';
import { db } from '@/lib/db';
import { clientIp } from '@/lib/newsletter';
import { currentOwner, sameOrigin } from '@/lib/owner';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string; slug: string }> };

// A signed-in owner whose category is sold out asks to hear when a featured spot opens
// (owner, 2026-10-17). The button says what it does; pressing it is the consent.
export async function POST(request: Request, { params }: Ctx) {
  const { host, slug } = await params;
  const town = await resolveTown(decodeURIComponent(host));
  if (!town) return new Response(null, { status: 404 });
  const email = await currentOwner(town);
  if (!email || !sameOrigin(request))
    return new Response(null, { status: 303, headers: { Location: '/owner' } });
  const listing = (await ownerListings(db(), town.id, email)).find((l) => l.slug === slug);
  const result = listing?.category
    ? await joinWaitlist(db(), {
        townId: town.id,
        category: listing.category,
        email,
        consent: true,
        source: 'owner',
        businessId: listing.id,
        ip: clientIp(request),
      })
    : 'invalid';
  return new Response(null, {
    status: 303,
    headers: { Location: `/owner/${encodeURIComponent(slug)}?s=waitlist_${result}#promote` },
  });
}
