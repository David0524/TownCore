import { loadEnv } from '@towncore/config';
import { getSessionStaff, type StaffMember } from '@towncore/db';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';

// Staff sessions for /admin: an httpOnly cookie holding a random token whose hash is in
// staff_sessions (docs/plans/M3.md §8).

export const SESSION_COOKIE = 'tc_admin';

export function adminBaseUrl(): string {
  return loadEnv().APP_BASE_URL ?? 'http://localhost:3000';
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: adminBaseUrl().startsWith('https://'),
    sameSite: 'lax' as const,
    path: '/admin',
    maxAge: maxAgeSeconds,
  };
}

export async function currentStaff(): Promise<StaffMember | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? getSessionStaff(db(), token) : null;
}

/** The signed-in staff member, or a redirect to the sign-in page. */
export async function requireStaff(): Promise<StaffMember> {
  const member = await currentStaff();
  if (!member) redirect('/admin/login');
  return member;
}
