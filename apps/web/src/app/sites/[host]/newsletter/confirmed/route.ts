import { confirmSubscription } from '@towncore/mail';
import { bulkDeps } from '@/lib/newsletter';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string }> };

// The button on /newsletter/confirm posts here. Confirmation is never done by a GET, so mail
// scanners that open links can't subscribe anyone.
export async function POST(request: Request, { params }: Ctx) {
  const town = await resolveTown((await params).host);
  if (!town) return new Response(null, { status: 404 });
  const deps = bulkDeps();
  const form = await request.formData().catch(() => null);
  const token = String(form?.get('t') ?? '');
  let status = 'bad_link';
  if (deps && token) {
    const result = await confirmSubscription(deps, token);
    if (result.status === 'expired') status = 'expired';
    else if ('townId' in result && result.townId === town.id) status = result.status;
  }
  return new Response(null, {
    status: 303,
    headers: { Location: `/newsletter?s=${status}#signup` },
  });
}
