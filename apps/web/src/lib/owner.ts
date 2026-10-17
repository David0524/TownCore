import { loadEnv } from '@towncore/config';
import type { Town } from '@towncore/db';
import { ownerForSession, type DirectoryMailDeps } from '@towncore/directory';
import { logTransport, sesTransport } from '@towncore/mail';
import { cookies } from 'next/headers';
import { db } from './db';

// The directory's account mail and owner sessions on town sites (M6 PR C).

/** Claim and sign-in mail, or null until conversational sending is set up. */
export function directoryMailDeps(): DirectoryMailDeps | null {
  const env = loadEnv();
  const mode = env.MAIL_TRANSPORT ?? (env.AWS_ACCESS_KEY_ID ? 'ses' : null);
  if (!mode) return null;
  if (mode === 'ses' && !env.SES_CONFIG_SET_CONVERSATIONAL) return null;
  return {
    db: db(),
    transport:
      mode === 'log' ? logTransport() : sesTransport({ region: env.AWS_REGION ?? 'us-east-1' }),
    configurationSet: env.SES_CONFIG_SET_CONVERSATIONAL ?? 'log',
    tokenSecret: env.MAIL_TOKEN_SECRET,
    postalAddress: env.MAIL_POSTAL_ADDRESS ?? null,
  };
}

/** One cookie per town host (cookies are per host), holding an opaque session token. */
export const OWNER_COOKIE = 'tc_owner';

/** The cookie for a new session; Secure whenever the site was reached over HTTPS. */
export function ownerCookie(token: string, request: Request) {
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ??
    new URL(request.url).protocol.replace(':', '');
  return {
    name: OWNER_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: proto === 'https',
    path: '/',
    maxAge: 30 * 86_400,
  };
}

/** The signed-in owner's email on this town's site, or null. */
export async function currentOwner(town: Pick<Town, 'id'>): Promise<string | null> {
  const token = (await cookies()).get(OWNER_COOKIE)?.value;
  return ownerForSession(db(), town.id, token);
}

/**
 * Same-site form posts only, so another site can't submit our owner forms. Browsers send Origin
 * on form posts; it must name the host the request came to.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get('host');
  } catch {
    return false;
  }
}
