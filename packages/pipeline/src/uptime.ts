import { and, desc, eq, gte, inArray, lt, ne, siteChecks, towns, type Db } from '@towncore/db';

// Uptime for Admin → Analytics (owner, 2026-10-17: "a little light showing that it's active or
// if the site is down"). Every few minutes the worker asks each live site's /api/health, which
// answers only when that host serves the town and the database responds. Nothing here depends
// on the hosting account: checks go to the public address, so moving the sites to another
// Vercel account changes nothing. A draft town is checked only when it has a preview address
// (SITE_CHECK_URLS, e.g. the demo).

/** A check slower than this, though it answered, shows the light as slow. */
export const SLOW_MS = 3_000;
/** Checks older than this mean nobody is checking: the light shows "not checked". */
export const STALE_MS = 20 * 60_000;
/** A site is down after this many failed checks in a row. */
export const DOWN_AFTER = 2;
/** Checks are kept this long. */
export const KEEP_DAYS = 30;
const TIMEOUT_MS = 10_000;
const DAY = 86_400_000;
const USER_AGENT = 'TownCoreBot/1.0 (info@towncore.net) uptime';

export type Light = 'up' | 'slow' | 'down' | 'unknown';
export const lightLabels: Record<Light, string> = {
  up: 'Up',
  slow: 'Slow',
  down: 'Down',
  unknown: 'Not checked',
};

type Check = { checkedAt: Date; ok: boolean; ms: number | null; error: string | null };

/** The light from a town's latest checks, newest first. */
export function lightFor(latest: readonly Check[], now: Date): { light: Light; why: string } {
  const last = latest[0];
  if (!last) return { light: 'unknown', why: 'No check yet.' };
  if (now.getTime() - last.checkedAt.getTime() > STALE_MS)
    return {
      light: 'unknown',
      why: `Last checked ${last.checkedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC: is the worker running?`,
    };
  let failures = 0;
  for (const c of latest) {
    if (c.ok) break;
    failures++;
  }
  if (failures >= DOWN_AFTER)
    return {
      light: 'down',
      why: `${failures} failed checks in a row: ${last.error ?? 'no answer'}.`,
    };
  if (failures === 1)
    return {
      light: 'slow',
      why: `The last check failed (${last.error ?? 'no answer'}); retrying.`,
    };
  if (last.ms !== null && last.ms > SLOW_MS)
    return { light: 'slow', why: `Answered in ${(last.ms / 1000).toFixed(1)} s.` };
  return { light: 'up', why: `Answered in ${last.ms ?? '?'} ms.` };
}

/** "slug=https://preview.example,slug2=…" → a map of preview base addresses. */
export function parseCheckUrls(value: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (value ?? '').split(',')) {
    const [slug, url] = part.split('=').map((s) => s?.trim());
    if (slug && url && /^https?:\/\//.test(url)) out.set(slug, url.replace(/\/+$/, ''));
  }
  return out;
}

export type SiteTarget = { townId: string; slug: string; url: string };

/** Live towns at their own domain; any town with a preview address at that address. */
export async function checkTargets(db: Db, previews: Map<string, string>): Promise<SiteTarget[]> {
  const rows = await db
    .select({ id: towns.id, slug: towns.slug, domain: towns.domain, status: towns.status })
    .from(towns)
    .where(ne(towns.status, 'paused'));
  return rows.flatMap((t) => {
    const base = previews.get(t.slug) ?? (t.status === 'live' ? `https://${t.domain}` : null);
    return base ? [{ townId: t.id, slug: t.slug, url: `${base}/api/health` }] : [];
  });
}

/** Asks one site's health endpoint; ok only when it names this town. */
export async function checkOne(
  target: SiteTarget,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; statusCode: number | null; ms: number; error: string | null }> {
  const started = Date.now();
  try {
    const res = await fetchImpl(target.url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - started;
    let body: { ok?: unknown; town?: unknown } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // not JSON: a parking page, an error page from the host
    }
    if (!res.ok) return { ok: false, statusCode: res.status, ms, error: `HTTP ${res.status}` };
    if (body.town !== target.slug)
      return {
        ok: false,
        statusCode: res.status,
        ms,
        error: body.town
          ? `the address serves ${String(body.town)}, not ${target.slug}`
          : 'the address doesn’t serve a TownCore site',
      };
    return {
      ok: body.ok === true,
      statusCode: res.status,
      ms,
      error: body.ok === true ? null : 'unhealthy',
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      statusCode: null,
      ms: Date.now() - started,
      error: timedOut
        ? 'no answer in 10 s'
        : error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

/** Checks every target (or one town's), records the results and drops checks past KEEP_DAYS. */
export async function checkSites(
  db: Db,
  opts: {
    previews?: Map<string, string>;
    fetchImpl?: typeof fetch;
    townId?: string;
    now?: () => Date;
  } = {},
): Promise<Array<SiteTarget & { ok: boolean; error: string | null }>> {
  const now = opts.now ?? (() => new Date());
  const targets = (await checkTargets(db, opts.previews ?? new Map())).filter(
    (t) => !opts.townId || t.townId === opts.townId,
  );
  const results = await Promise.all(
    targets.map(async (t) => ({ target: t, result: await checkOne(t, opts.fetchImpl) })),
  );
  if (results.length)
    await db.insert(siteChecks).values(
      results.map(({ target, result }) => ({
        townId: target.townId,
        checkedAt: now(),
        url: target.url,
        ok: result.ok,
        statusCode: result.statusCode,
        ms: result.ms,
        error: result.error,
      })),
    );
  await db
    .delete(siteChecks)
    .where(lt(siteChecks.checkedAt, new Date(now().getTime() - KEEP_DAYS * DAY)));
  return results.map(({ target, result }) => ({ ...target, ok: result.ok, error: result.error }));
}

export type Uptime = {
  light: Light;
  why: string;
  lastCheckedAt: Date | null;
  lastMs: number | null;
  /** Share of checks that passed, or null with no checks in the window. */
  day: number | null;
  week: number | null;
  month: number | null;
  recent: Array<Check & { statusCode: number | null }>;
};

/** Each town's light and uptime over 1, 7 and 30 days. */
export async function uptimeFor(
  db: Db,
  townIds: string[],
  now = new Date(),
): Promise<Map<string, Uptime>> {
  const out = new Map<string, Uptime>();
  if (!townIds.length) return out;
  const rows = await db
    .select({
      townId: siteChecks.townId,
      checkedAt: siteChecks.checkedAt,
      ok: siteChecks.ok,
      ms: siteChecks.ms,
      error: siteChecks.error,
      statusCode: siteChecks.statusCode,
    })
    .from(siteChecks)
    .where(
      and(
        inArray(siteChecks.townId, townIds),
        gte(siteChecks.checkedAt, new Date(now.getTime() - KEEP_DAYS * DAY)),
      ),
    )
    .orderBy(desc(siteChecks.checkedAt));
  const share = (list: typeof rows, days: number) => {
    const inWindow = list.filter((r) => now.getTime() - r.checkedAt.getTime() <= days * DAY);
    return inWindow.length ? inWindow.filter((r) => r.ok).length / inWindow.length : null;
  };
  for (const id of townIds) {
    const list = rows.filter((r) => r.townId === id);
    const { light, why } = lightFor(list.slice(0, 10), now);
    out.set(id, {
      light,
      why,
      lastCheckedAt: list[0]?.checkedAt ?? null,
      lastMs: list[0]?.ms ?? null,
      day: share(list, 1),
      week: share(list, 7),
      month: share(list, 30),
      recent: list.slice(0, 20),
    });
  }
  return out;
}

/** Live towns whose site is down, for the ops alerts. */
export async function downSites(db: Db, now = new Date()) {
  const live = await db
    .select({ id: towns.id, siteName: towns.siteName, domain: towns.domain })
    .from(towns)
    .where(eq(towns.status, 'live'));
  const uptime = await uptimeFor(
    db,
    live.map((t) => t.id),
    now,
  );
  return live.flatMap((t) => {
    const u = uptime.get(t.id);
    return u?.light === 'down' ? [{ ...t, why: u.why }] : [];
  });
}
