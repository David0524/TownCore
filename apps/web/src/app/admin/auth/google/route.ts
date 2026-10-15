import { loadEnv } from '@towncore/config';
import { NextResponse } from 'next/server';
import { authorizationUrl, encodeAttempt, newAttempt, signInMode } from '@/lib/admin/google';
import { adminBaseUrl, OAUTH_COOKIE, oauthCookieOptions } from '@/lib/admin/session';

// Starts Google sign-in: remember this attempt's state, nonce and PKCE verifier, then hand
// the browser to Google.
export async function GET() {
  const mode = signInMode(loadEnv());
  if (mode.kind !== 'google') {
    return NextResponse.redirect(new URL('/admin/login', adminBaseUrl()));
  }
  const attempt = newAttempt();
  const redirectUri = `${adminBaseUrl()}/admin/auth/google/callback`;
  const response = NextResponse.redirect(authorizationUrl(mode, redirectUri, attempt));
  response.cookies.set(OAUTH_COOKIE, encodeAttempt(attempt), oauthCookieOptions());
  return response;
}
