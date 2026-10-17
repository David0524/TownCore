import { directoryCategory } from '@towncore/config';
import { joinWaitlist } from '@towncore/directory';
import { db } from '@/lib/db';
import { directoryPath } from '@/lib/directory';
import { clientIp } from '@/lib/newsletter';
import { currentOwner, sameOrigin } from '@/lib/owner';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string }> };

// The featured-spot waitlist form (owner, 2026-10-17), on a category page or /advertise when
// every spot is sold. A filled honeypot gets the same thanks and stores nothing. Joining sends
// nothing now; the one notice when a spot opens is an owner follow-up (Rule 10).
export async function POST(request: Request, { params }: Ctx) {
  const town = await resolveTown(decodeURIComponent((await params).host));
  if (!town) return new Response(null, { status: 404 });
  const form = await request.formData().catch(() => null);
  const field = (k: string) => String(form?.get(k) ?? '').trim();
  const category = directoryCategory(field('category'));
  const source = field('source') === 'advertise' ? 'advertise' : 'category';
  const back = (s: string) =>
    new Response(null, {
      status: 303,
      headers: {
        Location: !category
          ? '/directory'
          : source === 'advertise'
            ? `/advertise?category=${category.slug}&waitlist=${s}#waitlist`
            : `${directoryPath(category.slug)}?waitlist=${s}#owner-h`,
      },
    });
  if (!form || !sameOrigin(request) || !category) return back('error');
  if (field('website')) return back('joined');
  // An owner signed in on this site joins with their own claim email.
  const owner = await currentOwner(town);
  try {
    return back(
      await joinWaitlist(db(), {
        townId: town.id,
        category: category.slug,
        email: field('email') || owner || '',
        consent: field('consent') === 'yes',
        source,
        ip: clientIp(request),
      }),
    );
  } catch (error) {
    console.error('waitlist join failed', error);
    return back('error');
  }
}
