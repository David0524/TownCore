import { isSignupPlacement } from '@towncore/config';
import { signup, type SignupOutcome } from '@towncore/mail';
import { bulkDeps, clientIp } from '@/lib/newsletter';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string }> };

const back = (status: string) =>
  new Response(null, { status: 303, headers: { Location: `/newsletter?s=${status}#signup` } });

// The signup form posts here (Mail-5): starts double opt-in, then sends the reader back to
// /newsletter with the outcome. Answers are the same for new and existing subscribers.
export async function POST(request: Request, { params }: Ctx) {
  const host = decodeURIComponent((await params).host);
  const town = await resolveTown(host);
  if (!town) return new Response(null, { status: 404 });
  const form = await request.formData().catch(() => null);
  const deps = bulkDeps();
  if (!form || !deps) return back('unavailable');
  const source = String(form.get('source') ?? '/');
  const placement = form.get('placement');
  let outcome: SignupOutcome;
  try {
    outcome = await signup(deps, {
      townId: town.id,
      email: String(form.get('email') ?? ''),
      honeypot: String(form.get('website') ?? ''),
      ip: clientIp(request),
      sourceUrl: `https://${host}${source.startsWith('/') ? source : '/'}`,
      placement: isSignupPlacement(placement) ? placement : null,
    });
  } catch (error) {
    console.error('newsletter signup failed', error);
    outcome = 'unavailable';
  }
  return back(outcome);
}
