import { loadEnv } from '@towncore/config';
import {
  createStaffSession,
  findOrCreateStaff,
  logAdminAction,
  SESSION_TTL_MS,
} from '@towncore/db';
import { NextResponse, type NextRequest } from 'next/server';
import {
  decodeAttempt,
  exchangeCode,
  GoogleSignInError,
  signInMode,
  verifyIdTokenClaims,
} from '@/lib/admin/google';
import {
  adminBaseUrl,
  OAUTH_COOKIE,
  oauthCookieOptions,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/lib/admin/session';
import { db } from '@/lib/db';

// Google sends the browser back here. Only a verified account on HQ_DOMAIN that is also on the
// staff allow-list (an active staff row, or ADMIN_EMAILS for the first sign-in) gets a session.
export async function GET(request: NextRequest) {
  const env = loadEnv();
  const mode = signInMode(env);
  const fail = (reason: string) => {
    console.warn(`[admin] Google sign-in refused: ${reason}`);
    const response = NextResponse.redirect(new URL('/admin/login?error=google', adminBaseUrl()));
    response.cookies.set(OAUTH_COOKIE, '', { ...oauthCookieOptions(), maxAge: 0 });
    return response;
  };
  if (mode.kind !== 'google') return fail('Google sign-in is not configured');

  const params = request.nextUrl.searchParams;
  const attempt = decodeAttempt(request.cookies.get(OAUTH_COOKIE)?.value);
  if (!attempt || params.get('state') !== attempt.state) return fail('state mismatch');
  const code = params.get('code');
  if (!code) return fail(params.get('error') ?? 'no code');

  const redirectUri = `${adminBaseUrl()}/admin/auth/google/callback`;
  let email: string;
  try {
    const idToken = await exchangeCode(mode, redirectUri, code, attempt.verifier);
    ({ email } = verifyIdTokenClaims(idToken, { ...mode, nonce: attempt.nonce }));
  } catch (error) {
    if (error instanceof GoogleSignInError) return fail(error.message);
    throw error;
  }

  const member = await findOrCreateStaff(db(), email, env.ADMIN_EMAILS ?? []);
  if (!member) return fail(`${email} is not on the staff allow-list`);
  const sessionToken = await createStaffSession(db(), member.id);
  await logAdminAction(db(), {
    staffId: member.id,
    action: 'sign_in',
    detail: { method: 'google' },
  });
  const response = NextResponse.redirect(new URL('/admin/review', adminBaseUrl()));
  response.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions(SESSION_TTL_MS / 1000));
  response.cookies.set(OAUTH_COOKIE, '', { ...oauthCookieOptions(), maxAge: 0 });
  return response;
}
