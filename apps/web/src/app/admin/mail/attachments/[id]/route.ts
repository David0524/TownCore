import { attachments, eq, messages } from '@towncore/db';
import { NextResponse } from 'next/server';
import { attachmentFiles } from '@/lib/admin/inbox';
import { adminBaseUrl, currentStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';

// Download an attachment (Mail-3): staff only, then a 5-minute presigned S3 URL.
// Quarantined (virus) attachments are never served.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentStaff()))
    return NextResponse.redirect(new URL('/admin/login', adminBaseUrl()));
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const [row] = await db()
    .select({ file: attachments, quarantined: messages.quarantined })
    .from(attachments)
    .innerJoin(messages, eq(attachments.messageId, messages.id))
    .where(eq(attachments.id, id));
  if (!row?.file.s3Key || row.quarantined) return new Response('Not found', { status: 404 });
  const files = attachmentFiles();
  if (!files)
    return new Response('Attachments are not configured (no AWS credentials).', { status: 503 });
  return NextResponse.redirect(await files.downloadUrl(row.file.s3Key, row.file.filename), 302);
}
