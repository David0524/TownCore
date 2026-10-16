import { requestOwnerLink } from '@towncore/directory';
import { directoryMailDeps, sameOrigin } from '@/lib/owner';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string }> };

const back = (s: string) =>
  new Response(null, { status: 303, headers: { Location: `/owner?s=${s}` } });

// Asks for an owner sign-in link. The answer is the same whether or not the address owns one.
export async function POST(request: Request, { params }: Ctx) {
  const town = await resolveTown(decodeURIComponent((await params).host));
  if (!town) return new Response(null, { status: 404 });
  const deps = directoryMailDeps();
  const form = await request.formData().catch(() => null);
  if (!deps || !form || !sameOrigin(request)) return back('unavailable');
  try {
    const outcome = await requestOwnerLink(deps, {
      townId: town.id,
      email: String(form.get('email') ?? ''),
    });
    return back(outcome === 'ok' ? 'sent' : outcome);
  } catch (error) {
    console.error('owner sign-in link failed', error);
    return back('unavailable');
  }
}
