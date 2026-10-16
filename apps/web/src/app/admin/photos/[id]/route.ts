import { eq, photoSubmissions } from '@towncore/db';
import { currentStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import { jpegResponse, photoStorage } from '@/lib/photos';

type Ctx = { params: Promise<{ id: string }> };

// A submitted photo for staff to review, whatever its status. Staff only, never cached.
export async function GET(_request: Request, { params }: Ctx) {
  if (!(await currentStaff())) return new Response(null, { status: 404 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response(null, { status: 404 });
  const [photo] = await db().select().from(photoSubmissions).where(eq(photoSubmissions.id, id));
  const bytes = photo ? await photoStorage().get(photo.storageKey) : null;
  if (!bytes) return new Response(null, { status: 404 });
  return jpegResponse(bytes, 'private, no-store');
}
