'use server';

import { loadEnv } from '@towncore/config';
import { createLoginToken, endSession, findOrCreateStaff, TooManyLoginLinks } from '@towncore/db';
import { logProvider, staffOnly } from '@towncore/email';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { adminBaseUrl, SESSION_COOKIE } from '@/lib/admin/session';
import { db } from '@/lib/db';

export type LoginState = { message: string } | null;

/** Emails a sign-in link to staff. Same answer for every address, so it can't probe emails. */
export async function requestLoginLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const sent: LoginState = {
    message:
      'If that address belongs to staff, a sign-in link is on its way. It works once, for 15 minutes.',
  };
  if (!email.includes('@')) return { message: 'Enter your email address.' };
  const adminEmails = loadEnv().ADMIN_EMAILS ?? [];
  const member = await findOrCreateStaff(db(), email, adminEmails);
  if (!member) return sent;
  let token: string;
  try {
    token = await createLoginToken(db(), member.id);
  } catch (error) {
    if (error instanceof TooManyLoginLinks) return { message: error.message };
    throw error;
  }
  const link = `${adminBaseUrl()}/admin/auth?token=${encodeURIComponent(token)}`;
  // Logged until the sending domain's DNS is set up (D-M3-2). staffOnly enforces Rule 10.
  await staffOnly(logProvider(), [member.email]).send({
    to: member.email,
    subject: 'Your TownCore admin sign-in link',
    text: `Sign in to TownCore admin:\n\n${link}\n\nThe link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.`,
  });
  return sent;
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await endSession(db(), token);
  jar.delete({ name: SESSION_COOKIE, path: '/admin' });
  redirect('/admin/login');
}
