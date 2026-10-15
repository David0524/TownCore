import { loadEnv } from '@towncore/config';
import type { Town } from '@towncore/db';
import { logTransport, newsletterDomain, sesTransport, type BulkDeps } from '@towncore/mail';
import { cache } from 'react';
import { db } from './db';

// Newsletter signups on town sites (Mail-5). Without sending set up (a transport, the bulk
// configuration set and MAIL_TOKEN_SECRET), or while the town's mail domain can't send bulk
// mail, the site keeps saying the newsletter is launching soon (D-M1-1).

export function bulkDeps(): BulkDeps | null {
  const env = loadEnv();
  const mode = env.MAIL_TRANSPORT ?? (env.AWS_ACCESS_KEY_ID ? 'ses' : null);
  if (!mode || !env.MAIL_TOKEN_SECRET) return null;
  if (mode === 'ses' && !env.SES_CONFIG_SET_BULK) return null;
  return {
    db: db(),
    transport:
      mode === 'log' ? logTransport() : sesTransport({ region: env.AWS_REGION ?? 'us-east-1' }),
    configurationSet: env.SES_CONFIG_SET_BULK ?? 'log',
    secret: env.MAIL_TOKEN_SECRET,
    postalAddress: env.MAIL_POSTAL_ADDRESS ?? null,
  };
}

/** Whether this town's site shows the signup form. */
export const newsletterOpen = cache(async (town: Pick<Town, 'id'>): Promise<boolean> => {
  const deps = bulkDeps();
  if (!deps) return false;
  return (await newsletterDomain(deps.db, town.id, deps.postalAddress)) !== null;
});

/** The reader's IP as the edge saw it, for consent records and signup rate limits. */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || null;
}

export const SIGNUP_MESSAGES: Record<string, { tone: 'ok' | 'error'; text: string }> = {
  ok: {
    tone: 'ok',
    text: 'Check your inbox: we sent a link to confirm your subscription. It expires in 7 days.',
  },
  invalid: { tone: 'error', text: 'That email address doesn’t look right. Please check it.' },
  unavailable: { tone: 'error', text: 'Signups aren’t open yet. Please try again soon.' },
  rate_limited: {
    tone: 'error',
    text: 'Too many signups from your connection. Please try again in an hour.',
  },
  confirmed: { tone: 'ok', text: 'You’re subscribed. The newsletter arrives every morning.' },
  already: { tone: 'ok', text: 'You’re already subscribed.' },
  expired: {
    tone: 'error',
    text: 'That confirmation link has expired. Sign up again below and we’ll send a new one.',
  },
  bad_link: { tone: 'error', text: 'That link isn’t valid. Sign up again below if you like.' },
};
