import { startClaim, type ClaimOutcome } from '@towncore/directory';
import { clientIp } from '@/lib/newsletter';
import { directoryMailDeps, sameOrigin } from '@/lib/owner';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string; slug: string }> };

// The claim form posts here, then the person goes back to the claim page with the outcome.
export async function POST(request: Request, { params }: Ctx) {
  const { host, slug } = await params;
  const town = await resolveTown(decodeURIComponent(host));
  if (!town) return new Response(null, { status: 404 });
  const back = (s: ClaimOutcome) =>
    new Response(null, {
      status: 303,
      headers: { Location: `/directory/claim/${encodeURIComponent(slug)}?s=${s}` },
    });
  const form = await request.formData().catch(() => null);
  const deps = directoryMailDeps();
  if (!form || !deps || !sameOrigin(request)) return back('unavailable');
  const field = (k: string) => String(form.get(k) ?? '');
  let outcome: ClaimOutcome;
  try {
    outcome = await startClaim(deps, {
      townId: town.id,
      slug,
      name: field('name'),
      role: field('role'),
      email: field('email'),
      attest: field('attest') === 'yes',
      honeypot: field('website'),
      ip: clientIp(request),
    });
  } catch (error) {
    console.error('directory claim failed', error);
    outcome = 'unavailable';
  }
  if (outcome === 'not_found') return new Response(null, { status: 404 });
  return back(outcome);
}
