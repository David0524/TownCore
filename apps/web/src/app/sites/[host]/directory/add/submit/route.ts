import { submitBusinessRequest, type RequestOutcome } from '@towncore/directory';
import { db } from '@/lib/db';
import { clientIp } from '@/lib/newsletter';
import { sameOrigin } from '@/lib/owner';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string }> };

const back = (s: RequestOutcome | 'error') =>
  new Response(null, { status: 303, headers: { Location: `/directory/add?s=${s}` } });

// The "Add your business" form posts here; a filled honeypot gets the same thanks and stores
// nothing. Staff decide each request in Admin → Directory.
export async function POST(request: Request, { params }: Ctx) {
  const town = await resolveTown(decodeURIComponent((await params).host));
  if (!town) return new Response(null, { status: 404 });
  const form = await request.formData().catch(() => null);
  if (!form || !sameOrigin(request)) return back('error');
  const field = (k: string) => String(form.get(k) ?? '');
  if (field('website')) return back('sent');
  try {
    return back(
      await submitBusinessRequest(db(), {
        townId: town.id,
        name: field('name'),
        category: field('category'),
        address: field('address'),
        zip: field('zip'),
        phone: field('phone'),
        website: field('site'),
        contactName: field('contact'),
        email: field('email'),
        note: field('note'),
        ip: clientIp(request),
      }),
    );
  } catch (error) {
    console.error('business request failed', error);
    return back('error');
  }
}
