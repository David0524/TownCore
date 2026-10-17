'use server';

import { loadEnv } from '@towncore/config';
import { checkSites, parseCheckUrls } from '@towncore/pipeline';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';

// Admin → Analytics → "Check now": the same uptime check the worker runs every 5 minutes, on
// demand (and the only check while no worker runs). Reads public pages; changes nothing.
export async function checkNowAction(form: FormData): Promise<void> {
  await requireStaff();
  const townId = String(form.get('townId') ?? '') || undefined;
  const back = String(form.get('back') ?? '/admin/analytics');
  const results = await checkSites(db(), {
    previews: parseCheckUrls(loadEnv().SITE_CHECK_URLS),
    ...(townId ? { townId } : {}),
  });
  revalidatePath('/admin/analytics');
  const down = results.filter((r) => !r.ok);
  const done = results.length
    ? `Checked ${results.length} site${results.length === 1 ? '' : 's'}: ${
        down.length
          ? `${down.length} not answering (${down.map((d) => d.slug).join(', ')})`
          : 'all up'
      }.`
    : 'Nothing to check: no live site, and no preview address in SITE_CHECK_URLS.';
  redirect(
    `${back.startsWith('/admin/analytics') ? back : '/admin/analytics'}${back.includes('?') ? '&' : '?'}${new URLSearchParams({ done })}`,
  );
}
