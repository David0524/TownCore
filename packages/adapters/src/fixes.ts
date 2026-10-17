import {
  adapterFixRequests,
  agentRuns,
  and,
  desc,
  eq,
  inArray,
  logAdminAction,
  sourceRuns,
  sources,
  sql,
  towns,
  type Db,
  type FixFailure,
} from '@towncore/db';
import { FetchPolicyError, NotModified, type Fetcher } from './http/fetcher';
import { recordingFetch, type FixtureFile } from './http/fixtures';
import { toSourceConfig } from './ingest';
import { getAdapter } from './registry';

// Self-healing adapters (owner, 2026-10-17; docs/plans/agentic-ops.md). When a source turns
// broken, the worker fetches it once more through the same polite Fetcher (Rule 8 unchanged),
// records that fetch as a fixture, classifies the failure in code and opens a fix request with
// the error, the fixture and the diagnosis. Writing the fix is writing adapter code, which never
// happens in the pipeline: a Claude Code session picks requests up (docs/ops/adapter-fix-routine.md).
// The same failure on one platform in several towns is one platform request, fixed once.

/** Towns with the same failure on one platform before it counts as a platform pattern. */
export const PLATFORM_PATTERN_TOWNS = 2;
/** The most of each recorded body kept with a request. */
const MAX_FIXTURE_BODY = 200_000;

export type Diagnosis = { failure: FixFailure; httpStatus: number | null; diagnosis: string };

/** What went wrong, from the error (and, for an empty result, the source's history). */
export function classifyFailure(input: {
  error: unknown;
  /** Items the re-check returned when it didn't throw. */
  items?: number;
  usuallyHasItems?: boolean;
}): Diagnosis {
  const { error } = input;
  if (error == null) {
    if (input.items === 0 && input.usuallyHasItems)
      return {
        failure: 'empty',
        httpStatus: null,
        diagnosis:
          'The fetch worked but returned nothing, though this source usually has items: the page or feed layout probably changed (selectors, field names or a moved feed). Compare the fixture with the adapter’s recorded fixtures.',
      };
    return {
      failure: 'unknown',
      httpStatus: null,
      diagnosis: 'The re-check worked; the earlier failures look transient. Watch it.',
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  if (
    error instanceof FetchPolicyError ||
    /disallowed by robots\.txt|Refusing to fetch/.test(message)
  ) {
    const robots = /robots\.txt/.test(message);
    return {
      failure: robots ? 'robots' : 'blocked',
      httpStatus: null,
      diagnosis: robots
        ? 'robots.txt now disallows this path for our bot. This is not an adapter bug and must not be worked around (Rule 8): stop the source, or find an allowed official source for the same records.'
        : 'The URL is on the never-scrape list or not a documented API (Rule 8). Remove the source.',
    };
  }
  const status = Number(message.match(/HTTP (\d{3})/)?.[1] ?? NaN);
  if (Number.isFinite(status)) {
    if (status === 401 || status === 403)
      return {
        failure: 'http_auth',
        httpStatus: status,
        diagnosis: `The site refuses us (HTTP ${status}). It may block our User-Agent or need a key now. Never disguise the bot (Rule 8); check the site's terms, then ask for access or drop the source.`,
      };
    if (status === 404 || status === 410)
      return {
        failure: 'http_gone',
        httpStatus: status,
        diagnosis: `The URL is gone (HTTP ${status}): the feed or page moved. Find its new address on the publisher's site and update the source, or the adapter's URL pattern if every town on the platform moved.`,
      };
    if (status === 429)
      return {
        failure: 'rate_limited',
        httpStatus: status,
        diagnosis:
          'The host says we are too fast (HTTP 429) even at our pace. Lower how often the source runs; never raise the request rate.',
      };
    if (status >= 500)
      return {
        failure: 'http_server',
        httpStatus: status,
        diagnosis: `The host is failing (HTTP ${status}). Usually it recovers by itself; if it lasts, the platform may have changed its API.`,
      };
  }
  if (name === 'TimeoutError' || name === 'AbortError' || /timed? ?out|timeout/i.test(message))
    return {
      failure: 'timeout',
      httpStatus: null,
      diagnosis:
        'The host did not answer in time. Check whether the file grew or the host is slow; consider a longer schedule.',
    };
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|certificate|TLS/i.test(message))
    return {
      failure: 'network',
      httpStatus: null,
      diagnosis:
        'The host could not be reached (DNS, connection or certificate). The site may have moved to a new domain.',
    };
  if (
    error instanceof SyntaxError ||
    /JSON|Unexpected token|parse|invalid|expected|schema|ZodError/i.test(`${name} ${message}`)
  )
    return {
      failure: 'parse',
      httpStatus: null,
      diagnosis:
        'The response no longer matches what the adapter reads (a format or field change). Update the parser against the fixture, and re-record the adapter’s fixtures.',
    };
  return {
    failure: 'unknown',
    httpStatus: null,
    diagnosis: 'Not classified in code; read the error and the fixture.',
  };
}

/** Caps recorded bodies so a request row stays small. */
export function trimFixture(file: FixtureFile): FixtureFile {
  return {
    recordedAt: file.recordedAt,
    exchanges: file.exchanges.map((e) => {
      if (e.body && e.body.length > MAX_FIXTURE_BODY)
        return { ...e, body: `${e.body.slice(0, MAX_FIXTURE_BODY)}\n[… truncated]` };
      if (e.bodyBase64 && e.bodyBase64.length > MAX_FIXTURE_BODY) {
        const { bodyBase64: _drop, ...rest } = e;
        return { ...rest, body: '[binary body too large to keep]' };
      }
      return e;
    }),
  };
}

async function usuallyHasItems(db: Db, sourceId: string): Promise<boolean> {
  const recent = await db
    .select({ items: sourceRuns.items })
    .from(sourceRuns)
    .where(and(eq(sourceRuns.sourceId, sourceId), eq(sourceRuns.status, 'ok')))
    .orderBy(desc(sourceRuns.startedAt))
    .limit(5);
  return recent.length >= 3 && recent.filter((r) => r.items > 0).length >= 3;
}

export type FixRun = { checked: number; opened: number; recovered: number; platforms: number };

/**
 * For each broken source without an open request: re-fetch once, record it, classify, and open a
 * request. Then group open requests into platform patterns.
 */
export async function diagnoseBrokenSources(
  db: Db,
  fetcher: Fetcher,
  now = new Date(),
): Promise<FixRun> {
  const run: FixRun = { checked: 0, opened: 0, recovered: 0, platforms: 0 };
  const broken = await db
    .select()
    .from(sources)
    .where(
      and(
        eq(sources.health, 'broken'),
        sql`${sources.townId} in (select id from towns where status <> 'paused')`,
        sql`not exists (select 1 from ${adapterFixRequests} r where r.source_id = ${sources.id} and r.scope = 'source' and r.status in ('open', 'in_progress'))`,
      ),
    );
  for (const source of broken) {
    run.checked++;
    const adapter = getAdapter(source.adapter);
    let recorder: ReturnType<typeof recordingFetch> | null = null;
    let error: unknown = null;
    let items: number | undefined;
    if (adapter) {
      // The same Fetcher (pace, robots.txt), sending through a recorder.
      const child = fetcher.withFetch((real) => (recorder = recordingFetch(real)).fetch);
      try {
        const fetched = await adapter.fetch(toSourceConfig(source), source.lastOkAt, {
          fetcher: child,
          now,
        });
        items = fetched.length;
      } catch (e) {
        if (!(e instanceof NotModified)) error = e;
      }
    } else error = new Error(`No adapter is registered for "${source.adapter}".`);
    // It works again (items, or the host said nothing changed): ingest will mark it healthy.
    if (error == null && (items === undefined || items > 0)) {
      run.recovered++;
      continue;
    }
    const diagnosis = classifyFailure({
      error: error ?? null,
      ...(items !== undefined ? { items } : {}),
      usuallyHasItems: await usuallyHasItems(db, source.id),
    });
    await db
      .insert(adapterFixRequests)
      .values({
        scope: 'source',
        sourceId: source.id,
        townId: source.townId,
        platform: source.platform,
        failure: diagnosis.failure,
        httpStatus: diagnosis.httpStatus,
        error: error
          ? error instanceof Error
            ? error.message
            : String(error)
          : (source.lastError ?? 'no items'),
        diagnosis: diagnosis.diagnosis,
        fixture: recorder
          ? trimFixture((recorder as ReturnType<typeof recordingFetch>).snapshot())
          : null,
      })
      .onConflictDoNothing();
    run.opened++;
  }
  run.platforms = await groupPlatformPatterns(db);
  await db.insert(agentRuns).values({
    agent: 'adapter-fixes',
    status: 'ok',
    summary: run,
    startedAt: now,
    finishedAt: new Date(),
  });
  return run;
}

/**
 * The same failure on one platform in several towns is one platform request: the town requests
 * point to it, and the fix is made once in the adapter, not town by town.
 */
export async function groupPlatformPatterns(db: Db): Promise<number> {
  const groups = await db
    .select({
      platform: adapterFixRequests.platform,
      failure: adapterFixRequests.failure,
      towns: sql<number>`count(distinct ${adapterFixRequests.townId})::int`,
    })
    .from(adapterFixRequests)
    .where(
      and(
        eq(adapterFixRequests.scope, 'source'),
        inArray(adapterFixRequests.status, ['open', 'in_progress']),
      ),
    )
    .groupBy(adapterFixRequests.platform, adapterFixRequests.failure);
  let made = 0;
  for (const g of groups) {
    if (g.towns < PLATFORM_PATTERN_TOWNS) continue;
    const members = await db
      .select()
      .from(adapterFixRequests)
      .where(
        and(
          eq(adapterFixRequests.scope, 'source'),
          eq(adapterFixRequests.platform, g.platform),
          eq(adapterFixRequests.failure, g.failure),
          inArray(adapterFixRequests.status, ['open', 'in_progress']),
        ),
      );
    let [parent] = await db
      .select()
      .from(adapterFixRequests)
      .where(
        and(
          eq(adapterFixRequests.scope, 'platform'),
          eq(adapterFixRequests.platform, g.platform),
          eq(adapterFixRequests.failure, g.failure),
          inArray(adapterFixRequests.status, ['open', 'in_progress']),
        ),
      );
    if (!parent) {
      const first = members[0]!;
      [parent] = await db
        .insert(adapterFixRequests)
        .values({
          scope: 'platform',
          platform: g.platform,
          failure: g.failure,
          httpStatus: first.httpStatus,
          error: first.error,
          diagnosis: `Platform pattern: the same ${g.failure.replace('_', ' ')} failure on ${g.platform} in ${g.towns} towns. Fix the ${g.platform} adapter once (with its shared fixtures), not town by town. ${first.diagnosis}`,
          fixture: first.fixture,
        })
        .onConflictDoNothing()
        .returning();
      if (!parent) continue;
      made++;
    } else {
      await db
        .update(adapterFixRequests)
        .set({
          diagnosis: parent.diagnosis.replace(/in \d+ towns/, `in ${g.towns} towns`),
          updatedAt: new Date(),
        })
        .where(eq(adapterFixRequests.id, parent.id));
    }
    await db
      .update(adapterFixRequests)
      .set({ platformRequestId: parent.id })
      .where(
        inArray(
          adapterFixRequests.id,
          members.map((m) => m.id),
        ),
      );
  }
  return made;
}

export type FixRequestRow = typeof adapterFixRequests.$inferSelect & {
  siteName: string | null;
  sourceKind: string | null;
  sourceUrl: string | null;
  /** Town requests under a platform request. */
  towns: number;
};

/** Open and recent requests for Admin → Fixes, platform patterns first. */
export async function listFixRequests(
  db: Db,
  opts: { all?: boolean } = {},
): Promise<FixRequestRow[]> {
  const rows = await db
    .select({
      r: adapterFixRequests,
      siteName: towns.siteName,
      sourceKind: sources.kind,
      sourceUrl: sources.url,
    })
    .from(adapterFixRequests)
    .leftJoin(towns, eq(towns.id, adapterFixRequests.townId))
    .leftJoin(sources, eq(sources.id, adapterFixRequests.sourceId))
    .where(opts.all ? undefined : inArray(adapterFixRequests.status, ['open', 'in_progress']))
    .orderBy(desc(adapterFixRequests.createdAt))
    .limit(200);
  const children = new Map<string, number>();
  for (const { r } of rows)
    if (r.platformRequestId)
      children.set(r.platformRequestId, (children.get(r.platformRequestId) ?? 0) + 1);
  return rows
    .map(({ r, siteName, sourceKind, sourceUrl }) => ({
      ...r,
      siteName,
      sourceKind,
      sourceUrl,
      towns: children.get(r.id) ?? 0,
    }))
    .sort((a, b) => Number(b.scope === 'platform') - Number(a.scope === 'platform'));
}

export class FixRequestRefused extends Error {}

/**
 * Staff move a request along: in progress (a session took it), fixed (with the PR), or dismissed
 * (with why). Closing a platform request closes the town requests under it. Audited.
 */
export async function updateFixRequest(
  db: Db,
  input: {
    id: string;
    status: 'in_progress' | 'fixed' | 'dismissed';
    staff: { id: string };
    prUrl?: string;
    note?: string;
  },
  now = new Date(),
) {
  if (input.prUrl && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(input.prUrl))
    throw new FixRequestRefused('Give the pull request as https://github.com/owner/repo/pull/N.');
  const closing = input.status !== 'in_progress';
  const [row] = await db
    .update(adapterFixRequests)
    .set({
      status: input.status,
      ...(input.prUrl ? { prUrl: input.prUrl } : {}),
      ...(input.note ? { note: input.note.slice(0, 1000) } : {}),
      ...(closing ? { resolvedBy: input.staff.id, resolvedAt: now } : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(adapterFixRequests.id, input.id),
        inArray(adapterFixRequests.status, ['open', 'in_progress']),
      ),
    )
    .returning();
  if (!row) throw new FixRequestRefused('Only an open request can change.');
  if (closing && row.scope === 'platform')
    await db
      .update(adapterFixRequests)
      .set({ status: input.status, resolvedBy: input.staff.id, resolvedAt: now, updatedAt: now })
      .where(
        and(
          eq(adapterFixRequests.platformRequestId, row.id),
          inArray(adapterFixRequests.status, ['open', 'in_progress']),
        ),
      );
  await logAdminAction(db, {
    staffId: input.staff.id,
    action: `adapter_fix.${input.status}`,
    target: { type: 'adapter_fix_request', id: row.id },
    detail: { platform: row.platform, failure: row.failure, prUrl: input.prUrl ?? null },
  });
  return row;
}
