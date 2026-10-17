import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Fetcher, FetchPolicyError } from '@towncore/adapters';
import { parseTownConfig } from '@towncore/config';
import { launches, townCandidates, towns, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  domainsFor,
  nameCandidates,
  newsSignals,
  officialSounding,
  patternOf,
  priorUse,
  registeredInRegistry,
  registrantFromEnv,
  resemblesOutlet,
  runLaunch,
  searchDomains,
  type NamesDetail,
  type Place,
  type ResolvedTown,
} from '../src';

// Launch step 2 (M7 PR C, CLAUDE.md §10b). Vercel's domain search and Verisign's RDAP answers are
// recorded (2026-10-16); Wayback CDX rows are copied from a real query for delraynews.com, and the
// archived pages are hand samples.

type Recorded = { url: string; method: string; status: number; body: string };
const recorded: Recorded[] = JSON.parse(
  readFileSync(new URL('./fixtures/domains/recorded.json', import.meta.url), 'utf8'),
);
const searchResults = JSON.parse(
  recorded.find((r) => r.url.endsWith('/registrar/domains/search'))!.body,
).results as Array<{ domain: string }>;

const CDX_DELRAYNEWS = [
  ['timestamp', 'statuscode'],
  ['20011203023727', '200'],
  ['20070708014446', '200'],
  ['20160107210719', '200'],
];
const NEWS_PAGE = `<html><head><title>Delray News - Local news for Delray Beach</title>
<meta property="og:type" content="article"></head><body><nav>Local News | Sports | Obituaries | Opinion</nav>
${Array.from({ length: 12 }, (_, i) => `<a href="/2015/0${(i % 9) + 1}/story-${i}">Story</a>`).join('')}</body></html>`;
const SHOP_PAGE = `<html><head><title>Courier Bikes of Delray</title></head><body>Bike repair and rentals.</body></html>`;

type Call = { url: string; method: string; body?: string; auth?: string | null };

function fakeRegistry(
  opts: { cdx?: Record<string, string[][] | 'down'>; pages?: Record<string, string> } = {},
) {
  const calls: Call[] = [];
  const fetcher = new Fetcher({
    minIntervalMs: 0,
    sleep: async () => {},
    fetchImpl: async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        method: init?.method ?? 'GET',
        ...(typeof init?.body === 'string' ? { body: init.body } : {}),
        auth: headers.get('authorization'),
      });
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      if (url.endsWith('/v1/registrar/domains/search')) {
        const asked = (JSON.parse(String(init?.body)) as { domains: string[] }).domains;
        return json({
          results: asked.map(
            (d) => searchResults.find((r) => r.domain === d) ?? { domain: d, available: false },
          ),
        });
      }
      if (url.includes('/v1/registrar/domains/') && url.includes('/buy'))
        return json({ orderId: 'ord_test1', _links: {} });
      if (url.includes('/v1/registrar/orders/'))
        return json({
          orderId: 'ord_test1',
          status: 'completed',
          domains: [{ domainName: 'delrayledger.com', status: 'completed', price: 11.25 }],
        });
      const rdap = url.match(/rdap\.verisign\.com\/com\/v1\/domain\/(.+)$/);
      if (rdap) {
        const hit = recorded.find((r) => r.url === url);
        return new Response(hit?.body ?? '', { status: hit?.status ?? 404 });
      }
      const cdx = url.match(/cdx\/search\/cdx\?url=([^&]+)/);
      if (cdx) {
        const rows = opts.cdx?.[decodeURIComponent(cdx[1]!)] ?? [];
        return rows === 'down' ? new Response('busy', { status: 503 }) : json(rows);
      }
      const snap = url.match(/web\.archive\.org\/web\/(\d+)id_\/http:\/\/([^/]+)\//);
      if (snap) return new Response(opts.pages?.[snap[2]!] ?? '<html></html>');
      // Later launch steps (state sources for Florida) aren't part of these tests.
      return new Response('not found', { status: 404 });
    },
  });
  return { fetcher, calls };
}

describe('site names', () => {
  it('rotates patterns, skips neighbors’ patterns and needs a nickname for the Post', () => {
    const names = (nearby: Parameters<typeof nameCandidates>[0]['nearbyPatterns'], use = {}) =>
      nameCandidates({ townWord: 'Delray', nearbyPatterns: nearby, networkUse: use }).map(
        (c) => c.siteName,
      );
    expect(names(['town-square']).slice(0, 4)).toEqual([
      'The Delray Ledger',
      'Delray Daily',
      'Delray Local',
      'Delray Courier',
    ]);
    expect(names([], { 'town-square': 3, ledger: 1 }).slice(0, 2)).toEqual([
      'Delray Daily',
      'Delray Local',
    ]);
    expect(
      nameCandidates({
        townWord: 'Delray',
        nickname: 'Village by the Sea',
        nearbyPatterns: [],
        networkUse: {},
      }).find((c) => c.pattern === 'post')!.siteName,
    ).toBe('The Village by the Sea Post');
    expect(names([]).includes('The Delray Standard')).toBe(true);
    expect(names([]).some((n) => n.endsWith('Post'))).toBe(false);
  });

  it('derives domains and recognizes existing names', () => {
    expect(domainsFor('The Delray Ledger')).toEqual(['delrayledger.com', 'thedelrayledger.com']);
    expect(domainsFor('Boca Town Square')).toEqual(['bocatownsquare.com']);
    expect(domainsFor('Española Daily')).toEqual(['espanoladaily.com']);
    expect(patternOf('Boca Town Square')).toBe('town-square');
    expect(patternOf('The Harbor Point Ledger')).toBe('ledger');
    expect(patternOf('Pine Hollow Gazette')).toBe('gazette');
    expect(patternOf('The Delray Standard')).toBe('standard');
    expect(patternOf('Pine Hollow News')).toBeNull();
  });

  it('blocks official-sounding names and look-alikes of local outlets', () => {
    expect(officialSounding('City of Delray Daily', 'cityofdelraydaily.com')).toMatch(/City of/);
    expect(officialSounding('Delray Local', 'delraygovlocal.com')).toMatch(/sounds official/);
    expect(officialSounding('Delray Courier', 'delraycourier.com')).toBeNull();
    const outlets = ['The Delray Newspaper', 'Delray Beach Tribune', 'Delray Daily News'];
    expect(resemblesOutlet('Delray Daily', outlets)).toBeNull();
    expect(resemblesOutlet('The Delray Beach Tribune', outlets)).toMatch(/Tribune/);
    expect(resemblesOutlet('Delray Dailey News', outlets)).toMatch(/Daily News/);
  });
});

describe('domain checks', () => {
  it('reads availability and price from the registrar (recorded)', async () => {
    const { fetcher } = fakeRegistry();
    const quotes = await searchDomains(fetcher, ['delrayledger.com', 'delraydaily.com']);
    expect(quotes).toEqual([
      {
        domain: 'delrayledger.com',
        available: true,
        years: 1,
        price: 11.25,
        renewalPrice: 11.25,
        premium: false,
      },
      { domain: 'delraydaily.com', available: false },
    ]);
  });

  it('cross-checks the .com registry over RDAP (recorded)', async () => {
    const { fetcher } = fakeRegistry();
    expect(await registeredInRegistry(fetcher, 'delraynews.com')).toBe(true);
    expect(await registeredInRegistry(fetcher, 'delraycourier.com')).toBe(false);
    expect(await registeredInRegistry(fetcher, 'delray.news')).toBeNull();
  });

  it('only POSTs to documented APIs', async () => {
    const { fetcher } = fakeRegistry();
    await expect(fetcher.postJson('https://example.com/api', {})).rejects.toThrow(FetchPolicyError);
  });

  it('finds news sites in the archive, and says when it could not check', async () => {
    expect(newsSignals(NEWS_PAGE)).toHaveLength(4);
    // One signal (a news word in a bike shop's name) is not enough to call it news.
    expect(newsSignals(SHOP_PAGE)).toHaveLength(1);
    const { fetcher, calls } = fakeRegistry({
      cdx: { 'delraynews.com': CDX_DELRAYNEWS, 'delraycourier.com': 'down' },
      pages: { 'delraynews.com': NEWS_PAGE },
    });
    const news = await priorUse(fetcher, 'delraynews.com');
    expect(news).toMatchObject({ captures: 3, years: ['2001', '2007', '2016'], news: true });
    expect(calls.filter((c) => c.url.includes('id_/'))).toHaveLength(3);
    expect(await priorUse(fetcher, 'delraycourier.com')).toBeNull();
    expect(await priorUse(fetcher, 'nothing-here.com')).toEqual({
      captures: 0,
      years: [],
      news: false,
      checked: [],
    });
  });

  it('needs every registrant field before a purchase', () => {
    expect(registrantFromEnv({ REGISTRANT_FIRST_NAME: 'A' }).missing).toContain('REGISTRANT_PHONE');
  });
});

const DELRAY: ResolvedTown = {
  slug: 'delray-beach',
  name: 'Delray Beach',
  state: 'FL',
  censusId: '1217100',
  censusName: 'Delray Beach city',
  county: 'Palm Beach',
  timezone: 'America/New_York',
  tier: 'mid',
  population2025: 69809,
  lat: 26.455903,
  lon: -80.09042,
  nws: { zone: 'FLZ068', office: 'MFL', point: '26.4559,-80.0904' },
  sameNameElsewhere: [],
  agencies: ['City of Delray Beach'],
};
const BOCA_PLACE: Place = {
  geoid: '1207300',
  state: 'FL',
  name: 'Boca Raton',
  censusName: 'Boca Raton city',
  lat: 26.375,
  lon: -80.108,
  landSqMi: 29,
};
const REGISTRANT = {
  REGISTRAR_API_KEY: 'test-token',
  VERCEL_TEAM_ID: 'team_test',
  REGISTRANT_FIRST_NAME: 'Pat',
  REGISTRANT_LAST_NAME: 'Owner',
  REGISTRANT_EMAIL: 'owner@example.com',
  REGISTRANT_PHONE: '+1.5615550100',
  REGISTRANT_ADDRESS1: '1 Main St',
  REGISTRANT_CITY: 'Boca Raton',
  REGISTRANT_STATE: 'FL',
  REGISTRANT_ZIP: '33432',
  REGISTRANT_COUNTRY: 'US',
};

describe('step 2 in a launch', () => {
  let db: Db;
  let drop: () => Promise<void>;
  const launchDir = mkdtempSync(join(tmpdir(), 'names-launch-'));
  const townsDir = mkdtempSync(join(tmpdir(), 'names-towns-'));
  const frictionLog = join(mkdtempSync(join(tmpdir(), 'names-friction-')), 'launch-friction.md');
  const registry = fakeRegistry({
    cdx: { 'delraycourier.com': CDX_DELRAYNEWS.slice(0, 3) },
    pages: { 'delraycourier.com': SHOP_PAGE },
  });
  const confirms: Array<{ domain: string; price: number }> = [];
  let answer = false;
  const deps = (env: Record<string, string> = {}) => ({
    db,
    launchDir,
    townsDir,
    frictionLog,
    resolve: async () => DELRAY,
    names: {
      fetcher: registry.fetcher,
      places: async () => [BOCA_PLACE],
      env,
      confirmPurchase: async (q: { domain: string; price: number }) => {
        confirms.push(q);
        return answer;
      },
    },
  });
  const town = 'Delray Beach, FL';

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    await db.insert(townCandidates).values({
      state: 'FL',
      geoid: '1217100',
      name: 'Delray Beach',
      inputs: {},
      score: 0.685,
      rank: 13,
      status: 'approved',
      rankedAt: new Date(),
    });
    await db.insert(towns).values({
      slug: 'boca-raton',
      name: 'Boca Raton',
      state: 'FL',
      censusId: '1207300',
      county: 'Palm Beach',
      timezone: 'America/New_York',
      domain: 'bocatownsquare.com',
      siteName: 'Boca Town Square',
      tier: 'large',
      config: {},
    });
  });
  afterAll(async () => drop());

  it('proposes names, skipping the neighbor’s pattern, and waits for a pick', async () => {
    const run = await runLaunch(deps(), { town, shortName: 'Delray' });
    expect(run.launch.status).toBe('stopped');
    expect(run.launch.stoppedReason).toMatch(/--resume --pick N/);
    expect(run.steps[1]).toMatchObject({ step: 'names', status: 'pending' });
    const detail = run.steps[1]!.detail as NamesDetail;
    expect(detail.neighbors).toEqual([
      { name: 'Boca Raton', siteName: 'Boca Town Square', pattern: 'town-square', miles: 6 },
    ]);
    // Only two names are free in the fixture, so it keeps looking through the shortlist of ten.
    expect(detail.proposals).toHaveLength(10);
    expect(detail.proposals.slice(0, 4).map((p) => [p.siteName, p.domain, p.blocked])).toEqual([
      ['The Delray Ledger', 'delrayledger.com', []],
      ['Delray Courier', 'delraycourier.com', []],
      ['Delray Daily', 'delraydaily.com', ['delraydaily.com is taken']],
      ['Delray Local', 'delraylocal.com', ['delraylocal.com is taken']],
    ]);
    expect(detail.proposals[1]!.review[0]).toMatch(/had a website before \(2001–2007\)/);
    const report = readFileSync(join(launchDir, 'delray-beach', 'names.md'), 'utf8');
    expect(report).toContain('## 1. The Delray Ledger');
    expect(report).toContain('$11.25 the first year');
    expect(report).toContain('https://tmsearch.uspto.gov/');
    expect(report).toContain('Boca Town Square (Boca Raton), 6 miles');
    expect(registry.calls.some((c) => c.url.includes('/buy'))).toBe(false);
  });

  it('re-checks when an outlet is added on resume', async () => {
    const run = await runLaunch(deps(), {
      town,
      resume: true,
      outlets: ['Delray Courier-Journal'],
    });
    const detail = run.steps[1]!.detail as NamesDetail;
    expect(detail.proposals.find((p) => p.siteName === 'Delray Courier')!.blocked).toEqual([]);
    const again = await runLaunch(deps(), { town, resume: true, outlets: ['The Delray Courier'] });
    expect(
      (again.steps[1]!.detail as NamesDetail).proposals.find(
        (p) => p.siteName === 'Delray Courier',
      )!.blocked,
    ).toEqual(['resembles the local outlet "The Delray Courier"']);
  });

  it('writes the town config for the pick and buys nothing in a dry run', async () => {
    const run = await runLaunch(deps(), { town, resume: true, pick: 1 });
    const step = run.steps[1]!;
    expect(step.status).toBe('done');
    expect((step.detail as NamesDetail).purchase).toEqual({
      status: 'not bought',
      reason: 'dry run (no --approve-spend)',
    });
    const file = join(townsDir, 'fl', 'delray-beach.yaml');
    expect(run.files).toContain(file);
    expect(parseTownConfig(readFileSync(file, 'utf8'))).toMatchObject({
      site_name: 'The Delray Ledger',
      domain: 'delrayledger.com',
    });
    // The run goes on to steps 3–5 (sources.test.ts); with no sources Delray fails Rule 7 here.
    expect(run.launch.stoppedReason).toMatch(/below the 3 a mid town needs \(Rule 7\)/);
    expect(confirms).toHaveLength(0);
  });

  it('needs credentials, then the typed confirmation, before buying', async () => {
    const noEnv = await runLaunch(deps(), { town, resume: true, approveSpend: true });
    expect(noEnv.launch.stoppedReason).toMatch(/Buying needs REGISTRAR_API_KEY and REGISTRANT_/);

    answer = false;
    const declined = await runLaunch(deps(REGISTRANT), { town, resume: true, approveSpend: true });
    expect(confirms).toEqual([{ domain: 'delrayledger.com', price: 11.25, renewalPrice: 11.25 }]);
    expect((declined.steps[1]!.detail as NamesDetail).purchase).toEqual({
      status: 'not bought',
      reason: 'the operator did not confirm',
    });
    expect(registry.calls.some((c) => c.url.includes('/buy'))).toBe(false);

    answer = true;
    const bought = await runLaunch(deps(REGISTRANT), { town, resume: true, approveSpend: true });
    expect((bought.steps[1]!.detail as NamesDetail).purchase).toEqual({
      orderId: 'ord_test1',
      status: 'completed',
      price: 11.25,
    });
    const buys = registry.calls.filter((c) => c.url.includes('/buy'));
    expect(buys).toHaveLength(1);
    expect(buys[0]!.url).toBe(
      'https://api.vercel.com/v1/registrar/domains/delrayledger.com/buy?teamId=team_test',
    );
    expect(buys[0]!.auth).toBe('Bearer test-token');
    expect(JSON.parse(buys[0]!.body!)).toMatchObject({
      autoRenew: true,
      years: 1,
      expectedPrice: 11.25,
      contactInformation: { firstName: 'Pat', phone: '+1.5615550100', country: 'US' },
    });

    // Bought once: resuming never buys again.
    await runLaunch(deps(REGISTRANT), { town, resume: true, approveSpend: true });
    expect(registry.calls.filter((c) => c.url.includes('/buy'))).toHaveLength(1);
    expect(existsSync(join(townsDir, 'fl', 'delray-beach.yaml'))).toBe(true);
    expect(await db.select().from(launches)).toHaveLength(1);
  });
});
