import { PhotoRejected, submitPhoto } from '@towncore/photos';
import { db } from '@/lib/db';
import { clientIp } from '@/lib/newsletter';
import { sameOrigin } from '@/lib/owner';
import { photosOpen, photoStorage } from '@/lib/photos';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string }> };

const back = (status: string) =>
  new Response(null, { status: 303, headers: { Location: `/photos?s=${status}#send` } });

// The reader photo form posts here (M9): re-encodes and stores the photo with the license grant,
// pending an editor's approval. A filled honeypot gets the same thanks and stores nothing.
export async function POST(request: Request, { params }: Ctx) {
  const host = decodeURIComponent((await params).host);
  const town = await resolveTown(host);
  if (!town) return new Response(null, { status: 404 });
  if (!sameOrigin(request)) return back('origin');
  if (!photosOpen()) return back('closed');
  const form = await request.formData().catch(() => null);
  if (!form) return back('empty');
  if (String(form.get('website') ?? '')) return back('thanks');
  const file = form.get('photo');
  const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array();
  const text = (name: string) => String(form.get(name) ?? '');
  try {
    await submitPhoto(db(), photoStorage(), {
      townId: town.id,
      kind: 'reader',
      bytes,
      caption: text('caption'),
      takenWhere: text('where'),
      takenWhen: text('when'),
      credit: text('credit'),
      name: text('name'),
      email: text('email'),
      agreed: text('agree') === 'yes',
      ip: clientIp(request),
    });
  } catch (error) {
    if (error instanceof PhotoRejected) return back(error.code);
    console.error('photo submission failed', error);
    return back('error');
  }
  return back('thanks');
}
