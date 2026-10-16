import { redeemOwnerLink } from '@towncore/directory';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { ownerCookie, sameOrigin } from '@/lib/owner';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const town = await resolveTown(decodeURIComponent((await params).host));
  if (!town) return new Response(null, { status: 404 });
  const form = await request.formData().catch(() => null);
  const session =
    form && sameOrigin(request)
      ? await redeemOwnerLink(db(), town.id, String(form.get('t') ?? ''))
      : null;
  if (!session)
    return new Response(null, { status: 303, headers: { Location: '/owner?s=expired' } });
  (await cookies()).set(ownerCookie(session, request));
  return new Response(null, { status: 303, headers: { Location: '/owner' } });
}
