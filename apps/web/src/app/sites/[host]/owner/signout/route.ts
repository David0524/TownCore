import { endOwnerSession } from '@towncore/directory';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { OWNER_COOKIE } from '@/lib/owner';

export async function POST() {
  const jar = await cookies();
  const token = jar.get(OWNER_COOKIE)?.value;
  if (token) await endOwnerSession(db(), token);
  jar.delete(OWNER_COOKIE);
  return new Response(null, { status: 303, headers: { Location: '/owner?s=out' } });
}
