import { approvedPhoto } from '@towncore/photos';
import { db } from '@/lib/db';
import { jpegResponse, photoStorage } from '@/lib/photos';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string; file: string }> };

// Serves an approved photo of this town (/photos/<id>.jpg). Pending and rejected photos, and
// other towns' photos, are a 404.
export async function GET(_request: Request, { params }: Ctx) {
  const { host, file } = await params;
  const town = await resolveTown(decodeURIComponent(host));
  const id = /^([0-9a-f-]{36})\.jpg$/i.exec(file)?.[1];
  if (!town || !id) return new Response(null, { status: 404 });
  const photo = await approvedPhoto(db(), town.id, id);
  const bytes = photo ? await photoStorage().get(photo.storageKey) : null;
  if (!bytes) return new Response(null, { status: 404 });
  return jpegResponse(bytes);
}
