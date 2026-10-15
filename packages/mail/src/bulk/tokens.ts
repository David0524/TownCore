import { createHmac, timingSafeEqual } from 'node:crypto';

// Subscriber links (brief §7.3). Unsubscribe tokens never expire and confirmation tokens last
// 7 days; both are HMAC-SHA256 over the subscriber id with MAIL_TOKEN_SECRET and a purpose, so
// one can't stand in for the other and neither can be guessed or enumerated.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function mac(secret: string, purpose: string, body: string): string {
  return createHmac('sha256', secret).update(`${purpose}\n${body}`).digest('base64url');
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function unsubscribeToken(secret: string, subscriberId: string): string {
  return `${subscriberId}.${mac(secret, 'unsubscribe', subscriberId)}`;
}

/** The subscriber id, or null if the token isn't ours. */
export function verifyUnsubscribeToken(secret: string, token: string): string | null {
  const [id, sig, ...rest] = token.split('.');
  if (!id || !sig || rest.length || !UUID.test(id)) return null;
  return same(sig, mac(secret, 'unsubscribe', id)) ? id : null;
}

export function confirmToken(secret: string, subscriberId: string, expiresAt: Date): string {
  const exp = Math.floor(expiresAt.getTime() / 1000).toString(36);
  return `${subscriberId}.${exp}.${mac(secret, 'confirm', `${subscriberId}.${exp}`)}`;
}

export type ConfirmCheck = { id: string } | { error: 'invalid' | 'expired' };

export function verifyConfirmToken(secret: string, token: string, now = new Date()): ConfirmCheck {
  const [id, exp, sig, ...rest] = token.split('.');
  if (!id || !exp || !sig || rest.length || !UUID.test(id) || !/^[0-9a-z]+$/.test(exp))
    return { error: 'invalid' };
  if (!same(sig, mac(secret, 'confirm', `${id}.${exp}`))) return { error: 'invalid' };
  if (parseInt(exp, 36) * 1000 < now.getTime()) return { error: 'expired' };
  return { id };
}
