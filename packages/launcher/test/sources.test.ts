import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Fetcher } from '@towncore/adapters';
import { parseTownConfig } from '@towncore/config';
import {
  aiUsage,
  articles,
  eq,
  records,
  sources,
  townCandidates,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import type { LlmProvider, LlmRequest } from '@towncore/pipeline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  parseSourceFlags,
  platformHint,
  runLaunch,
  verifyUrl,
  withSources,
  type DiscoverDetail,
  type ReadinessDetail,
  type SeedDetail,
  type ResolvedTown,
} from '../src';

// Launch steps 3–5 (M7 PR D) against a fictional CivicPlus city, served by a fake web that
// follows the real platform's URLs, plus a robots-blocked host, a host that refuses us (as
// delraybeachfl.gov's CDN did on 2026-10-16) and a Legistar page no adapter reads yet.

const NOW = new Date('2026-10-16T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const body = 'The city announced the change at its regular meeting. '.repeat(10);

function ics(dates: Date[]) {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    ...dates.flatMap((d, i) => [
      'BEGIN:VEVENT',
      `UID:${100 + i}`,
      `DTSTART:${stamp(d)}`,
      `DTEND:${stamp(new Date(d.getTime() + 3_600_000))}`,
      `SUMMARY:City Commission Meeting ${i + 1}`,
      'LOCATION:City Hall',
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ].join('\r\n');
}

function rss(origin: string, items: Array<{ id: number; title: string; date: Date }>) {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>News Flash</title>${items
    .map(
      (i) =>
        `<item><title>${i.title}</title><link>${origin}/CivicAlerts.aspx?AID=${i.id}</link><pubDate>${i.date.toUTCString()}</pubDate></item>`,
    )
    .join('')}</channel></rss>`;
}

const CITY = 'https://www.harborcity.gov';
const POLICE = 'https://police.harborcity.gov';
const releases = (n: number, from: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: from + i,
    title: i % 10 === 9 ? `Elsewhere County item ${i}` : `City release ${from + i}`,
    date: day((i % 28) + 1),
  }));

function fakeWeb() {
  const requests: string[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push(url);
    const ok = (text: string) => new Response(text, { status: 200 });
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
    const u = new URL(url);
    if (u.hostname === 'cdn-denied.example.gov')
      return new Response('Access Denied', { status: 403 });
    if (u.pathname === '/robots.txt')
      return u.hostname === 'blocked.example.gov'
        ? ok('User-agent: *\nDisallow: /')
        : ok('User-agent: *\nDisallow: /RSS.aspx');
    // Registrar, registry and archive (step 2).
    if (url.endsWith('/v1/registrar/domains/search')) {
      const asked = (JSON.parse(String(init?.body)) as { domains: string[] }).domains;
      return json({
        results: asked.map((domain) => ({
          domain,
          available: true,
          years: 1,
          price: 12,
          renewalPrice: 12,
          premium: false,
        })),
      });
    }
    if (u.hostname === 'rdap.verisign.com') return new Response('', { status: 404 });
    if (u.hostname === 'web.archive.org') return json([]);
    // USASpending: every town's federal awards source (no awards in this fake town).
    if (u.hostname === 'api.usaspending.gov') return json({ results: [] });
    if (u.hostname === 'legistar.example.com')
      return ok('<html><body>Powered by Legistar</body></html>');
    // CivicPlus sites.
    if (u.origin === CITY || u.origin === POLICE) {
      if (u.pathname === '/' || u.pathname === '/Home')
        return ok('<html><body>Government Websites by CivicPlus® CivicEngage</body></html>');
      if (u.pathname === '/Calendar.aspx')
        return ok(
          `<label for="chkCalendarID_29"><input type="checkbox" value="29">City Commission Meetings</label>`,
        );
      if (u.pathname === '/common/modules/iCalendar/iCalendar.aspx')
        return ok(ics([day(3), day(10), day(17), day(45)]));
      if (u.pathname === '/RSSFeed.aspx')
        return ok(rss(u.origin, u.origin === CITY ? releases(40, 1000) : releases(60, 5000)));
      const detail = u.pathname.match(/\/m\/newsflash\/home\/detail\/(\d+)/);
      if (detail) return ok(`<div class="fr-view"><p>${body}</p></div>`);
    }
    return new Response('not found', { status: 404 });
  };
  return {
    requests,
    fetcher: new Fetcher({ fetchImpl, sleep: async () => {}, now: () => 0, minIntervalMs: 0 }),
  };
}

/** A model with web search: answers discovery and classification like the real prompts ask. */
function fakeModel(): LlmProvider & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    name: 'anthropic',
    webSearch: true,
    calls,
    async generate(request) {
      calls.push(request);
      const usage = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0 };
      if (request.system.includes('official public sources')) {
        return {
          text: JSON.stringify({
            sources: [
              {
                kind: 'city_news',
                url: `${CITY}/Home`,
                publisher: 'City of Harbor City',
                why: 'News Flash',
              },
              {
                kind: 'agenda',
                url: `${CITY}/Home`,
                publisher: 'City of Harbor City',
                why: 'Calendar',
              },
              {
                kind: 'agenda',
                url: 'https://legistar.example.com/Calendar.aspx',
                publisher: 'City',
                why: 'Agendas',
              },
              {
                kind: 'police',
                url: 'https://blocked.example.gov/news',
                publisher: 'Police',
                why: 'News',
              },
              {
                kind: 'schools',
                url: 'https://cdn-denied.example.gov/',
                publisher: 'Schools',
                why: 'News',
              },
            ],
            outlets: [{ name: 'Harbor City Herald', url: null, status: 'defunct' }],
          }),
          stop: 'end',
          model: 'claude-opus-5-5',
          usage,
          webSearches: 4,
        };
      }
      if (request.system.includes('You design the look')) {
        return {
          text: JSON.stringify({
            identityNotes: 'A harbor town of oaks, squares and brick warehouses on the river.',
            family: 'heritage',
            accent: '#8A3324',
            secondary: null,
            motif: 'oak',
            masthead: 'ruled-nameplate',
            tagline: 'News from the squares',
            header: 'nameplate-double-rule',
            grid: 'single-column',
            article: 'wide-reading',
            directory: 'category-grid',
            footer: 'minimal',
            corners: 'square',
          }),
          stop: 'end',
          model: 'claude-opus-5-5',
          usage,
        };
      }
      const elsewhere = /Title: Elsewhere/.test(request.input);
      return {
        text: JSON.stringify({
          beat: 'government',
          about_this_town: !elsewhere,
          town_evidence: elsewhere ? 'none' : 'City of Harbor City',
          people: [],
          sensitive: {
            crime_or_public_safety: false,
            health: false,
            inspection_failure: false,
            accusatory: false,
            arrest_without_official_release: false,
            victim_of_sexual_assault: false,
            rumor_or_social_post: false,
          },
          impact: 0.5,
          novelty: 0.5,
          proximity: 0.5,
          proposed_tier: 2,
          reason: 'civic notice',
          // Claude's classify (v2) also reports its confidence.
          ...(request.system.includes('confidence (0–1)') ? { confidence: 0.9 } : {}),
        }),
        stop: 'end',
        model: 'claude-haiku-5-5',
        usage,
      };
    },
  };
}

const TOWN: ResolvedTown = {
  slug: 'harbor-city',
  name: 'Harbor City',
  state: 'GA',
  censusId: '1399999',
  censusName: 'Harbor City city',
  county: 'Chatham',
  timezone: 'America/New_York',
  tier: 'small',
  population2025: 12000,
  lat: 32.08,
  lon: -81.09,
  nws: { zone: 'GAZ119', office: 'CHS', point: '32.0800,-81.0900' },
  sameNameElsewhere: [],
  agencies: ['City of Harbor City'],
};

describe('discovery helpers', () => {
  it('parses --source flags and names unknown platforms', () => {
    expect(parseSourceFlags(['agenda=https://x.gov/cal'])).toEqual([
      { kind: 'agenda', url: 'https://x.gov/cal' },
    ]);
    expect(() => parseSourceFlags(['https://x.gov'])).toThrow(/kind=url/);
    expect(platformHint('https://city.granicus.com/ViewPublisher.php', '')).toBe('Granicus');
    expect(platformHint('https://x.gov', '<link href="/wp-content/x.css">')).toBe('WordPress');
  });

  it('decides each URL by fetching it under Rule 8', async () => {
    const { fetcher, requests } = fakeWeb();
    const v = (kind: 'agenda' | 'police' | 'schools', url: string) =>
      verifyUrl(fetcher, { kind, url, origin: 'flag' }, NOW);
    expect(await v('police', 'https://blocked.example.gov/news')).toMatchObject({
      status: 'blocked',
    });
    expect(requests).not.toContain('https://blocked.example.gov/news');
    expect(await v('schools', 'https://cdn-denied.example.gov/')).toMatchObject({
      status: 'unreadable',
      detail: expect.stringMatching(/403/),
    });
    expect(await v('agenda', 'https://legistar.example.com/Calendar.aspx')).toMatchObject({
      status: 'unknown',
      hint: 'Legistar',
    });
    const city = await v('agenda', `${CITY}/Home`);
    expect(city).toMatchObject({ status: 'matched', platform: 'civicplus' });
    expect(city.sources).toEqual([
      {
        kind: 'agenda',
        platform: 'civicplus',
        url: `${CITY}/`,
        options: { module: 'calendar', catId: '29' },
        label: 'CivicPlus calendar: City Commission Meetings',
      },
    ]);
    expect(await v('police', `${CITY}/Home`)).toMatchObject({ status: 'matched' });
    expect(await v('permits' as 'agenda', `${CITY}/Home`)).toMatchObject({ status: 'no-feed' });
  });

  it('rewrites only the sources block of a town file', () => {
    const yaml = `slug: x\nsources:\n  # weather\n  - kind: weather\n    platform: nws\n    zone: GAZ119\npricing: { featured_usd: [1, 1, 1], enhanced_usd: 1 }\n`;
    const out = withSources(
      yaml,
      [
        { kind: 'weather', platform: 'nws', zone: 'GAZ119' },
        {
          kind: 'city_news',
          platform: 'civicplus',
          url: `${CITY}/`,
          options: { module: 'newsflash', catId: 'All-newsflash.xml' },
        },
      ],
      [],
    );
    expect(out).toContain('pricing: { featured_usd: [1, 1, 1], enhanced_usd: 1 }');
    expect(out).toContain(
      [
        'sources:',
        '  - kind: weather',
        '    platform: nws',
        '    zone: GAZ119',
        '  - kind: city_news',
      ].join('\n'),
    );
  });
});

describe('steps 3–5 in a launch', () => {
  let db: Db;
  let drop: () => Promise<void>;
  const launchDir = mkdtempSync(join(tmpdir(), 'src-launch-'));
  const townsDir = mkdtempSync(join(tmpdir(), 'src-towns-'));
  const frictionLog = join(mkdtempSync(join(tmpdir(), 'src-friction-')), 'launch-friction.md');
  const web = fakeWeb();
  const model = fakeModel();
  const deps = () => ({
    db,
    launchDir,
    townsDir,
    frictionLog,
    now: () => NOW,
    resolve: async () => TOWN,
    fetcher: web.fetcher,
    llm: { providerName: 'anthropic' as const, provider: model, db, now: () => NOW },
    names: {
      fetcher: web.fetcher,
      places: async () => [],
      env: {},
      confirmPurchase: async () => false,
    },
  });
  const town = 'Harbor City, GA';

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    await db.insert(townCandidates).values({
      state: 'GA',
      geoid: '1399999',
      name: 'Harbor City',
      inputs: {},
      score: 0.5,
      rank: 1,
      status: 'approved',
      rankedAt: NOW,
    });
  });
  afterAll(async () => drop());

  it('discovers, verifies and reports a readiness gap without stopping (Rule 7)', async () => {
    await runLaunch(deps(), { town });
    const run = await runLaunch(deps(), { town, resume: true, pick: 1 });
    const step = (s: string) => run.steps.find((x) => x.step === s)!;

    const discovery = step('sources').detail as DiscoverDetail;
    expect(discovery.mode).toBe('model');
    expect(discovery.findings.map((f) => [f.kind, f.status])).toEqual([
      // Every town gets federal awards without discovery (USASpending).
      ['federal_awards', 'matched'],
      ['city_news', 'matched'],
      ['agenda', 'matched'],
      ['agenda', 'unknown'],
      ['police', 'blocked'],
      ['schools', 'unreadable'],
    ]);
    expect(discovery.outlets).toEqual([
      { name: 'Harbor City Herald', url: null, status: 'defunct' },
    ]);

    // Step 4 wrote the verified sources into the town file and the draft town.
    const file = join(townsDir, 'ga', 'harbor-city.yaml');
    const config = parseTownConfig(readFileSync(file, 'utf8'));
    expect(config.sources.map((s) => [s.kind, s.platform, s.options?.module ?? null])).toEqual([
      ['weather', 'nws', null],
      ['federal_awards', 'usaspending', null],
      ['city_news', 'civicplus', 'newsflash'],
      ['agenda', 'civicplus', 'calendar'],
    ]);
    expect(readFileSync(file, 'utf8')).toContain(
      '# CivicPlus News Flash (all categories) (verified by launch step 3)',
    );
    const [row] = await db.select().from(towns).where(eq(towns.slug, 'harbor-city'));
    expect(row!.status).toBe('draft');
    expect(readFileSync(join(launchDir, 'harbor-city', 'adapter-requests.md'), 'utf8')).toMatch(
      /## agenda: https:\/\/legistar\.example\.com\/Calendar\.aspx\n\n- Platform: Legistar/,
    );

    // 36 of 40 releases are about the town (every tenth is elsewhere), plus 3 weekly meeting
    // roundups: 39 items in 30 days, 1.3 a day, short of the target of 3. The launch goes on.
    const readiness = step('readiness');
    expect(readiness.status).toBe('done');
    expect(step('report').status).toBe('done');
    const measured = readiness.detail as ReadinessDetail;
    expect(measured).toMatchObject({
      itemsPerDay: 1.3,
      minimum: 3,
      passed: false,
      mode: 'classified',
    });
    expect(measured.bySource.map((s) => [s.kind, s.items]).sort()).toEqual([
      ['agenda', 3],
      ['city_news', 36],
      ['federal_awards', 0],
    ]);
    const [scored] = await db.select().from(towns).where(eq(towns.slug, 'harbor-city'));
    expect(scored!.readinessScore).toBe(1.3);
    // The report shows the gap as a target, readiness by source, and the sources to find.
    const report = readFileSync(join(launchDir, 'harbor-city', 'launch-report.md'), 'utf8');
    expect(report).toContain(
      '| Readiness (Rule 7 target) | Below target | 1.3 real items a day; target 3 (classified). |',
    );
    expect(report).toContain('| city_news (civicplus) | ok |');
    expect(report).toMatch(/- \[ \] Readiness is 1\.3 a day, short of the 3 target \(Rule 7\)/);
    expect(report).toContain(
      "can't be read (robots.txt, or the site refused us): blocked.example.gov, cdn-denied.example.gov",
    );
    // Records were ingested, but nothing was written: readiness only counts.
    expect((await db.select().from(records)).length).toBeGreaterThan(40);
    expect(await db.select().from(articles)).toHaveLength(0);
  });

  it('re-runs discovery for a new --source, passes, and finishes with a report', async () => {
    const run = await runLaunch(deps(), { town, resume: true, sources: [`police=${POLICE}/Home`] });
    const measured = run.steps.find((s) => s.step === 'readiness')!.detail as ReadinessDetail;
    // The police site has 60 releases (54 about the town): 93 items, 3.1 a day.
    expect(measured).toMatchObject({ itemsPerDay: 3.1, passed: true });
    // Steps 6–8 ran: seeded through the normal pipeline, themed, provisioned (dry run), reported.
    expect(run.launch.status).toBe('ready');
    expect(run.steps.every((s) => s.status === 'done')).toBe(true);
    const themeFile = join(townsDir, 'ga', 'harbor-city.theme.json');
    // The model asked for heritage, but 3.1 items a day is under 5: community, briefing-led.
    expect(JSON.parse(readFileSync(themeFile, 'utf8'))).toMatchObject({
      family: 'community',
      motif: 'oak',
      masthead: 'ruled-nameplate',
      layout: { header: 'nameplate-double-rule', grid: 'single-column' },
    });
    const [synced] = await db.select().from(towns).where(eq(towns.slug, 'harbor-city'));
    expect(synced!.theme).toMatchObject({ family: 'community' });
    expect(synced!.status).toBe('draft');
    // Seeding ran the story finder on the town's last week; this fake model can't write drafts,
    // so its accepted stories were skipped by the writer (a real model writes them).
    const seed = run.steps.find((s) => s.step === 'seed')!.detail as SeedDetail;
    expect(seed.finder.candidates).toBeGreaterThan(0);
    expect(seed.directory).toEqual({
      skipped: 'No state license adapter for GA yet; the directory starts empty.',
    });
    const report = readFileSync(join(launchDir, 'harbor-city', 'launch-report.md'), 'utf8');
    expect(report).toContain('# Launch report: Harbor City Town Square (Harbor City, GA)');
    // Screenshots weren't taken (no --site), so the report isn't passing yet and says why.
    expect(report).toContain('**Not passing yet:**');
    expect(report).toContain('| Every page type renders | Not run |');
    expect(report).toContain(
      '| Readiness (Rule 7 target) | Pass | 3.1 real items a day; target 3 (classified). |',
    );
    expect(report).toMatch(/Family \*\*community\*\*, brand color #[0-9A-F]{6}, motif oak/);
    expect(report).toContain(
      '3.1 items a day is under 5: the briefing-led community family is used',
    );
    expect(report).toContain('pnpm mail:onboard add harborcitytownsquare.com --execute --approved');
    // Chatham County isn't in the county registry and the test's catalogs answer nothing, so
    // county data becomes the first to-do (owner, 2026-10-17).
    const friction = readFileSync(frictionLog, 'utf8');
    expect(friction).toMatch(
      /## Harbor City, GA \(2026-10-16\)\n\n- Chatham County isn't in the county registry, and discovery found no parcel, sales or permit data set/,
    );
    expect(friction).toContain('- Buy harborcitytownsquare.com');
    const config = parseTownConfig(readFileSync(join(townsDir, 'ga', 'harbor-city.yaml'), 'utf8'));
    expect(config.sources.filter((s) => s.kind === 'police')).toHaveLength(1);
    // Weather, city news, the agenda calendar, police, and federal awards.
    expect(await db.select().from(sources)).toHaveLength(5);
    // Every model call was logged against the draft town as launch work, web searches priced.
    const usage = await db.select().from(aiUsage);
    expect(new Set(usage.map((u) => u.job))).toEqual(
      new Set([
        'launch.discover',
        'launch.readiness',
        'story-finder.classify',
        'writer',
        'launch.theme',
      ]),
    );
    // The re-run asked the same question (a --source flag isn't model input), so discovery's
    // stored answer came back: one paid search, never two (model protocol: idempotency).
    const discover = usage.filter((u) => u.job === 'launch.discover');
    expect(discover).toHaveLength(1);
    expect(Number(discover[0]!.estCostUsd)).toBeCloseTo(0.004 + 0.004 + 0.04, 6);
  });
});
