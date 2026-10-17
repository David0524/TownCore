import {
  articles,
  articleStatsDaily,
  businesses,
  countEngagedTime,
  countPageView,
  leads,
  placements,
  siteChecks,
  slotStatsDaily,
  stripePrices,
  subscribers,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { networkAnalytics, siteAnalytics } from '../src/analytics';
import { opsConditions } from '../src/ops';
import { checkOne, checkSites, lightFor, parseCheckUrls, uptimeFor } from '../src/uptime';

// Admin → Analytics (owner, 2026-10-17): site age and the up/down light, then traffic, time on
// page, the newsletter, advertisers and money.

const NOW = new Date('2026-10-17T15:00:00Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);

let db: Db;
let drop: () => Promise<void>;
let liveId: string;
let draftId: string;

const town = (slug: string, status: 'live' | 'draft', liveAt: Date | null) => ({
  slug,
  name: slug,
  state: 'ZZ',
  county: 'Sample',
  timezone: 'America/New_York',
  domain: `${slug}.test`,
  siteName: `${slug} Square`,
  status,
  liveAt,
  tier: 'small' as const,
  config: {},
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  const [live] = await db
    .insert(towns)
    .values(town('bayside', 'live', new Date('2026-09-17T12:00:00Z')))
    .returning();
  const [draft] = await db
    .insert(towns)
    .values(town('hilltop', 'draft', null))
    .returning();
  liveId = live!.id;
  draftId = draft!.id;
});
afterAll(async () => drop());

describe('the status light', () => {
  const check = (minutes: number, ok: boolean, ms = 200) => ({
    checkedAt: ago(minutes),
    ok,
    ms,
    error: ok ? null : 'HTTP 502',
  });
  it('is up after a quick answer, slow after a slow one or one failure, down after two', () => {
    expect(lightFor([], NOW).light).toBe('unknown');
    expect(lightFor([check(2, true)], NOW).light).toBe('up');
    expect(lightFor([check(2, true, 4_500)], NOW)).toMatchObject({ light: 'slow' });
    expect(lightFor([check(2, false), check(7, true)], NOW).light).toBe('slow');
    expect(lightFor([check(2, false), check(7, false), check(12, true)], NOW)).toMatchObject({
      light: 'down',
      why: '2 failed checks in a row: HTTP 502.',
    });
    // Nobody has checked for half an hour: say so instead of showing an old green.
    expect(lightFor([check(30, true)], NOW).light).toBe('unknown');
  });

  it('reads preview addresses for towns not on their own domain yet', () => {
    expect(parseCheckUrls('hilltop=https://preview.example/, bad, x=ftp://no')).toEqual(
      new Map([['hilltop', 'https://preview.example']]),
    );
  });
});

describe('checking sites', () => {
  it('counts a site as up only when its health endpoint names this town', async () => {
    const target = { townId: liveId, slug: 'bayside', url: 'https://bayside.test/api/health' };
    expect(await checkOne(target, async () => json({ ok: true, town: 'bayside' }))).toMatchObject({
      ok: true,
      statusCode: 200,
    });
    expect(await checkOne(target, async () => json({ ok: true, town: 'hilltop' }))).toMatchObject({
      ok: false,
      error: 'the address serves hilltop, not bayside',
    });
    expect(
      await checkOne(target, async () => new Response('parked', { status: 200 })),
    ).toMatchObject({ ok: false, error: 'the address doesn’t serve a TownCore site' });
    expect(await checkOne(target, async () => json({ ok: false }, 503))).toMatchObject({
      ok: false,
      error: 'HTTP 503',
    });
    expect(
      await checkOne(target, async () => {
        throw new TypeError('getaddrinfo ENOTFOUND bayside.test');
      }),
    ).toMatchObject({ ok: false, error: 'getaddrinfo ENOTFOUND bayside.test' });
  });

  it('checks live towns at their domain and drafts only at a preview, then alerts when one is down', async () => {
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      asked.push(url);
      return url.includes('bayside') ? json({}, 502) : json({ ok: true, town: 'hilltop' });
    }) as typeof fetch;
    const previews = new Map([['hilltop', 'https://hilltop-preview.example']]);
    await checkSites(db, { previews, fetchImpl, now: () => ago(6) });
    const results = await checkSites(db, { previews, fetchImpl, now: () => ago(1) });
    expect(asked.slice(0, 2).sort()).toEqual([
      'https://bayside.test/api/health',
      'https://hilltop-preview.example/api/health',
    ]);
    expect(results.map((r) => [r.slug, r.ok]).sort()).toEqual([
      ['bayside', false],
      ['hilltop', true],
    ]);
    const uptime = await uptimeFor(db, [liveId, draftId], NOW);
    expect(uptime.get(liveId)).toMatchObject({ light: 'down', day: 0 });
    expect(uptime.get(draftId)).toMatchObject({ light: 'up', day: 1 });
    const keys = (await opsConditions(db, NOW)).map((c) => c.key);
    expect(keys).toContain(`site_down:${liveId}`);
    expect(keys).not.toContain(`site_down:${draftId}`);
    // Without a preview address a draft isn't checked at all.
    asked.length = 0;
    await checkSites(db, { fetchImpl, now: () => NOW });
    expect(asked).toEqual(['https://bayside.test/api/health']);
    await db.delete(siteChecks);
  });
});

describe('the numbers', () => {
  beforeAll(async () => {
    const [story] = await db
      .insert(articles)
      .values({
        townId: liveId,
        slug: 'pier-reopens',
        headline: 'The pier reopens',
        bodyMd: 'x',
        beat: 'community',
        tier: 1,
        status: 'published',
        byline: 'bayside Square Newsroom',
        sourceRecordIds: [crypto.randomUUID()],
        publishedAt: NOW,
      })
      .returning();
    await db.insert(articleStatsDaily).values([
      { articleId: story!.id, townId: liveId, day: day(1), views: 30, listClicks: 6 },
      { articleId: story!.id, townId: liveId, day: day(40), views: 999 },
    ]);
    for (let i = 0; i < 3; i++) await countPageView(db, liveId, day(1), 'home');
    await countPageView(db, liveId, day(1), 'article');
    await countEngagedTime(db, liveId, day(1), 'article', 90, 'pier-reopens');
    await countEngagedTime(db, liveId, day(1), 'home', 30);
    // A tab left open counts as 30 minutes, and nothing for a page that wasn't seen.
    await countEngagedTime(db, liveId, day(1), 'home', 99_999);
    await countEngagedTime(db, liveId, day(1), 'home', 0);
    await db.insert(slotStatsDaily).values({
      townId: liveId,
      day: day(2),
      slot: 'rail.box',
      impressions: 200,
      clicks: 4,
      leads: 1,
    });
    await db.insert(subscribers).values([
      {
        townId: liveId,
        email: 'a@x.test',
        status: 'active',
        confirmedAt: new Date(NOW.getTime() - 2 * 86_400_000),
      },
      {
        townId: liveId,
        email: 'b@x.test',
        status: 'active',
        confirmedAt: new Date('2026-08-01T00:00:00Z'),
      },
      { townId: liveId, email: 'c@x.test', status: 'pending' },
      { townId: liveId, email: 'd@x.test', status: 'unsubscribed' },
    ]);
    const [paid, trial] = await db
      .insert(businesses)
      .values([
        {
          townId: liveId,
          slug: 'acme-plumbing',
          name: 'Acme Plumbing',
          category: 'plumbers',
          dataSource: 'request',
        },
        {
          townId: liveId,
          slug: 'bay-roofing',
          name: 'Bay Roofing',
          category: 'roofers',
          dataSource: 'request',
        },
      ])
      .returning();
    await db.insert(stripePrices).values([
      {
        townId: liveId,
        product: 'sponsored_slot',
        rank: 1,
        stripeProductId: 'prod_1',
        stripePriceId: 'price_19',
        unitAmountCents: 1900,
        active: true,
      },
      {
        townId: liveId,
        product: 'sponsored_slot',
        rank: 2,
        stripeProductId: 'prod_1',
        stripePriceId: 'price_12',
        unitAmountCents: 1200,
        active: true,
      },
    ]);
    await db.insert(placements).values([
      {
        businessId: paid!.id,
        townId: liveId,
        product: 'sponsored_slot',
        category: 'plumbers',
        rank: 1,
        stripePriceId: 'price_19',
        status: 'active',
        startsAt: new Date('2026-08-01T00:00:00Z'),
        stripeSubscriptionId: 'sub_1',
      },
      {
        businessId: trial!.id,
        townId: liveId,
        product: 'sponsored_slot',
        category: 'roofers',
        rank: 2,
        stripePriceId: 'price_12',
        status: 'active',
        startsAt: ago(60 * 24 * 3),
        trialEndsAt: new Date(NOW.getTime() + 20 * 86_400_000),
        stripeSubscriptionId: 'sub_2',
      },
    ]);
    await db
      .insert(leads)
      .values({ businessId: paid!.id, townId: liveId, kind: 'call', createdAt: ago(60) });
  });

  it('adds up the window per site and for the network, with age and money', async () => {
    const { sites, totals } = await networkAnalytics(db, { days: 30, now: NOW });
    expect(sites.map((s) => s.slug)).toEqual(['bayside', 'hilltop']);
    const bay = sites[0]!;
    expect(bay.ageDays).toBe(30);
    expect(bay.totals).toMatchObject({
      pageViews: 4,
      storyViews: 30,
      storyClicks: 6,
      adImpressions: 200,
      adClicks: 4,
      leads: 1,
      subscribers: 2,
      newSubscribers: 1,
      advertisers: 2,
      trialing: 1,
      mrrCents: 1900,
    });
    // (90 + 30 + 1800) seconds over 3 visits that reported time.
    expect(bay.totals.avgEngagedSeconds).toBe(640);
    expect(sites[1]!.totals.pageViews).toBe(0);
    expect(totals).toMatchObject({ pageViews: 4, mrrCents: 1900, subscribers: 2 });
  });

  it('shows one site in depth, with a point for every day', async () => {
    const site = await siteAnalytics(db, 'bayside', { days: 7, now: NOW });
    expect(site!.daily).toHaveLength(8);
    expect(site!.daily.find((d) => d.day === day(1))).toMatchObject({
      pageViews: 4,
      storyViews: 30,
    });
    expect(site!.topStories[0]).toMatchObject({
      slug: 'pier-reopens',
      views: 30,
      clicks: 6,
      avgEngagedSeconds: 90,
    });
    expect(site!.newsletter).toEqual({ active: 2, pending: 1, left: 1 });
    expect(site!.slots[0]).toMatchObject({ slot: 'rail.box', impressions: 200, clicks: 4 });
    expect(site!.advertisers.map((a) => [a.business, a.monthlyCents])).toEqual([
      ['Acme Plumbing', 1900],
      ['Bay Roofing', 1200],
    ]);
    expect(await siteAnalytics(db, 'nowhere', { days: 7, now: NOW })).toBeNull();
  });
});
