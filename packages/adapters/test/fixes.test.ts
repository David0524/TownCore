import {
  adapterFixRequests,
  agentRuns,
  eq,
  sourceRuns,
  sources,
  staff,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  classifyFailure,
  diagnoseBrokenSources,
  Fetcher,
  FetchPolicyError,
  FixRequestRefused,
  listFixRequests,
  registerAdapter,
  updateFixRequest,
  type SourceAdapter,
} from '../src';

// Self-healing adapters (docs/plans/agentic-ops.md): a broken source is re-fetched once through
// the polite Fetcher, recorded, diagnosed in code and given a fix request; the same failure on
// one platform in two towns is a platform pattern.

const NOW = new Date('2026-10-17T12:00:00Z');

describe('classifying a failure', () => {
  it('reads the cause from the error and the history', () => {
    expect(
      classifyFailure({
        error: new FetchPolicyError('Refusing to fetch x: disallowed by robots.txt'),
      }).failure,
    ).toBe('robots');
    expect(classifyFailure({ error: new Error('GET x failed: HTTP 403') })).toMatchObject({
      failure: 'http_auth',
      httpStatus: 403,
    });
    expect(classifyFailure({ error: new Error('GET x failed: HTTP 404') }).failure).toBe(
      'http_gone',
    );
    expect(classifyFailure({ error: new Error('GET x failed: HTTP 503') }).failure).toBe(
      'http_server',
    );
    expect(classifyFailure({ error: new Error('HTTP 429') }).failure).toBe('rate_limited');
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    expect(classifyFailure({ error: timeout }).failure).toBe('timeout');
    expect(classifyFailure({ error: new Error('getaddrinfo ENOTFOUND city.gov') }).failure).toBe(
      'network',
    );
    expect(classifyFailure({ error: new SyntaxError('Unexpected token < in JSON') }).failure).toBe(
      'parse',
    );
    expect(classifyFailure({ error: null, items: 0, usuallyHasItems: true }).failure).toBe('empty');
    expect(
      classifyFailure({ error: new FetchPolicyError('disallowed by robots.txt') }).diagnosis,
    ).toMatch(/must not be worked around \(Rule 8\)/);
  });
});

describe('fix requests for broken sources', () => {
  let db: Db;
  let drop: () => Promise<void>;
  const ids: Record<string, string> = {};
  const hits: string[] = [];
  let mode: 'gone' | 'ok' = 'gone';
  const fetcher = new Fetcher({
    minIntervalMs: 0,
    sleep: async () => {},
    fetchImpl: async (url) => {
      hits.push(String(url));
      if (String(url).endsWith('/robots.txt')) return new Response('', { status: 404 });
      if (mode === 'ok')
        return new Response('{"items":[1]}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      return new Response('<html>Not here</html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      });
    },
  });
  const adapter: SourceAdapter = {
    platform: 'testplat',
    kinds: ['city_news'],
    detect: async () => 0,
    fetch: async (source, _since, ctx) => {
      const body = await ctx.fetcher.getJson<{ items: number[] }>(source.url!);
      return body.items.map((n) => ({ externalId: String(n), type: 'news', title: 'x', raw: {} }));
    },
    healthCheck: async () => ({ ok: true }),
  };

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    registerAdapter(adapter);
    for (const slug of ['a', 'b', 'c']) {
      const [t] = await db
        .insert(towns)
        .values({
          slug,
          name: slug,
          state: 'FL',
          county: 'X',
          timezone: 'America/New_York',
          domain: `${slug}.test`,
          siteName: `${slug} Daily`,
          tier: 'small',
          status: 'live',
          config: {},
        })
        .returning();
      const [s] = await db
        .insert(sources)
        .values({
          townId: t!.id,
          kind: 'city_news',
          platform: 'testplat',
          adapter: 'testplat',
          url: `https://${slug}.example.gov/feed.json`,
          health: slug === 'c' ? 'ok' : 'broken',
          lastError: 'GET failed: HTTP 404',
          consecutiveFailures: 3,
        })
        .returning();
      ids[slug] = s!.id;
      await db.insert(sourceRuns).values({
        sourceId: s!.id,
        townId: t!.id,
        status: 'ok',
        items: 4,
        startedAt: new Date('2026-10-01'),
      });
    }
  });
  afterAll(async () => drop());

  it('records the failing fetch, diagnoses it, and groups a platform pattern', async () => {
    const run = await diagnoseBrokenSources(db, fetcher, NOW);
    expect(run).toEqual({ checked: 2, opened: 2, recovered: 0, platforms: 1 });
    // robots.txt was checked before the page, as for any fetch (Rule 8).
    expect(hits.filter((h) => h.endsWith('/robots.txt')).length).toBeGreaterThan(0);
    const rows = await listFixRequests(db);
    expect(rows[0]).toMatchObject({
      scope: 'platform',
      platform: 'testplat',
      failure: 'http_gone',
      towns: 2,
    });
    expect(rows[0]!.diagnosis).toMatch(/Platform pattern: .* in 2 towns/);
    const town = rows.find((r) => r.sourceId === ids.a)!;
    expect(town).toMatchObject({
      failure: 'http_gone',
      httpStatus: 404,
      siteName: 'a Daily',
      platformRequestId: rows[0]!.id,
    });
    const fixture = town.fixture as {
      exchanges: Array<{ url: string; status: number; body?: string }>;
    };
    expect(fixture.exchanges.at(-1)).toMatchObject({
      url: 'https://a.example.gov/feed.json',
      status: 404,
      body: '<html>Not here</html>',
    });
    // A second run opens nothing new for sources that already have a request.
    expect(await diagnoseBrokenSources(db, fetcher, NOW)).toMatchObject({ checked: 0, opened: 0 });
    expect((await db.select().from(agentRuns)).every((r) => r.agent === 'adapter-fixes')).toBe(
      true,
    );
  });

  it('closes the town requests with their platform request; a source that works again opens none', async () => {
    const [me] = await db
      .insert(staff)
      .values({ email: 'ed@towncore.net', name: 'Ed', role: 'reviewer' })
      .returning();
    const [platform] = (await listFixRequests(db)).filter((r) => r.scope === 'platform');
    await expect(
      updateFixRequest(db, { id: platform!.id, status: 'fixed', staff: me!, prUrl: 'http://evil' }),
    ).rejects.toThrow(FixRequestRefused);
    await updateFixRequest(db, {
      id: platform!.id,
      status: 'fixed',
      staff: me!,
      prUrl: 'https://github.com/David0524/TownCore/pull/200',
    });
    expect(await listFixRequests(db)).toEqual([]);
    const all = await db.select().from(adapterFixRequests);
    expect(all.every((r) => r.status === 'fixed')).toBe(true);

    mode = 'ok';
    await db.update(sources).set({ health: 'broken' }).where(eq(sources.id, ids.c!));
    expect(await diagnoseBrokenSources(db, fetcher, NOW)).toMatchObject({
      checked: 3,
      recovered: 3,
      opened: 0,
    });
  });
});
