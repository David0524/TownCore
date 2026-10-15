import { loadEnv } from '@towncore/config';
import { attachments, eq, messages } from '@towncore/db';
import { INLINE_IMAGE_TYPES, verifyAttachment } from '@towncore/mail';
import { attachmentFiles } from '@/lib/admin/inbox';
import { db } from '@/lib/db';

// Inline images inside the sandboxed message frame (Mail-3). The frame can't send the staff
// cookie, so the URL carries a 15-minute signature instead. Raster images only, never from a
// quarantined message, and served with headers that stop them being anything but an image.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const secret = loadEnv().MAIL_TOKEN_SECRET;
  if (
    !secret ||
    !verifyAttachment(secret, id, url.searchParams.get('exp'), url.searchParams.get('sig'))
  ) {
    return new Response('Forbidden', { status: 403 });
  }
  const [row] = await db()
    .select({ file: attachments, quarantined: messages.quarantined })
    .from(attachments)
    .innerJoin(messages, eq(attachments.messageId, messages.id))
    .where(eq(attachments.id, id));
  if (
    !row?.file.s3Key ||
    row.quarantined ||
    !INLINE_IMAGE_TYPES.has(row.file.contentType.toLowerCase())
  ) {
    return new Response('Not found', { status: 404 });
  }
  const files = attachmentFiles();
  if (!files) return new Response('Attachments are not configured.', { status: 503 });
  const body = await files.read(row.file.s3Key);
  return new Response(new Uint8Array(body), {
    headers: {
      'content-type': row.file.contentType.toLowerCase(),
      'content-disposition': 'inline',
      'cache-control': 'private, max-age=900',
      'content-security-policy': "default-src 'none'",
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'cross-origin',
    },
  });
}
