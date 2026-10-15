import { createHmac, timingSafeEqual } from 'node:crypto';

// Short-lived signed URLs for attachments (brief Phase 3). Inline images inside the sandboxed
// message frame can't carry the staff cookie, so their URLs carry a signature instead: the
// attachment id and an expiry, HMAC-SHA256 with MAIL_TOKEN_SECRET.

export const INLINE_URL_TTL_MS = 15 * 60_000;

function mac(secret: string, purpose: string, id: string, exp: number): string {
  return createHmac('sha256', secret).update(`${purpose}\n${id}\n${exp}`).digest('base64url');
}

export function signAttachment(
  secret: string,
  id: string,
  now = Date.now(),
  ttl = INLINE_URL_TTL_MS,
) {
  const exp = Math.floor((now + ttl) / 1000);
  return { exp, sig: mac(secret, 'attachment-inline', id, exp) };
}

export function verifyAttachment(
  secret: string,
  id: string,
  exp: string | null,
  sig: string | null,
  now = Date.now(),
) {
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 < now) return false;
  const want = Buffer.from(mac(secret, 'attachment-inline', id, Number(exp)));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
