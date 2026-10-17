import { verifyClaim } from '@towncore/directory';
import { db } from '@/lib/db';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const town = await resolveTown(decodeURIComponent((await params).host));
  if (!town) return new Response(null, { status: 404 });
  const form = await request.formData().catch(() => null);
  const result = await verifyClaim(db(), town.id, String(form?.get('t') ?? ''));
  return new Response(null, {
    status: 303,
    headers: {
      Location: `/directory/claim/verify?s=${result.status}${result.status === 'pending' && result.category ? `&c=${encodeURIComponent(result.category)}` : ''}`,
    },
  });
}
