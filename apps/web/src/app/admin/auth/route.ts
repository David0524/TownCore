import { loadEnv } from '@towncore/config';
import { logAdminAction, redeemLoginToken, SESSION_TTL_MS } from '@towncore/db';
import { NextResponse, type NextRequest } from 'next/server';
import { signInMode } from '@/lib/admin/google';
import { adminBaseUrl, SESSION_COOKIE, sessionCookieOptions } from '@/lib/admin/session';
import { db } from '@/lib/db';

// The link in the sign-in email: trade a one-time token for a session cookie. Only while
// Google sign-in isn't configured (local development and CI; D-MAIL-2).
export async function GET(request: NextRequest) {
  if (signInMode(loadEnv()).kind !== 'email') {
    return NextResponse.redirect(new URL('/admin/login', adminBaseUrl()));
  }
  const token = request.nextUrl.searchParams.get('token') ?? '';
  const result = token ? await redeemLoginToken(db(), token) : null;
  if (!result) {
    return NextResponse.redirect(new URL('/admin/login?error=link', adminBaseUrl()));
  }
  await logAdminAction(db(), {
    staffId: result.staff.id,
    action: 'sign_in',
    detail: { method: 'email' },
  });
  const response = NextResponse.redirect(new URL('/admin/review', adminBaseUrl()));
  response.cookies.set(
    SESSION_COOKIE,
    result.sessionToken,
    sessionCookieOptions(SESSION_TTL_MS / 1000),
  );
  return response;
}
