import {
  adminActions,
  articles,
  articleStatsDaily,
  businesses,
  countReferral,
  eq,
  experimentAssignments,
  placements,
  sources,
  staff,
  stripePrices,
  subscribers,
  towns,
  townVariant,
  type Db,
  type StaffMember,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  byCohort,
  byPlatform,
  funnelRates,
  groupAudience,
  townAudience,
  emptyCounts,
} from '../src/audience';
import {
  decideExperiment,
  ExperimentRefused,
  experimentReports,
  startExperiment,
  stopExperiment,
} from '../src/experiments';

// Audience and revenue per town, cohort and platform, and experiments (owner, 2026-10-17).

const NOW = new Date('2026-10-17T15:00:00Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

let db: Db;
let drop: () => Promise<void>;
let oneId: string;
let twoId: string;
let admin: StaffMember;
let reviewer: StaffMember;

const town = (slug: string, cohort: string | null, households: number | null) => ({
  slug,
  name: slug,
  state: 'ZZ',
  county: 'Sample',
  timezone: 'America/New_York',
  domain: `${slug}.test`,
  siteName: `${slug} Square`,
  status: cohort ? ('live' as const) : ('draft' as const),
  cohort,
  households,
  tier: 'small' as const,
  config: { pricing: { featured_usd: [19, 12, 7], enhanced_usd: 39, free_trial_days: 30 } },
});

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  const [one] = await db
    .insert(towns)
    .values(town('one', '2026-09', 2000))
    .returning();
  const [two] = await db
    .insert(towns)
    .values(town('two', null, null))
    .returning();
  oneId = one!.id;
  twoId = two!.id;
  [admin, reviewer] = (await db
    .insert(staff)
    .values([
      { email: 'a@towncore.net', name: 'A', role: 'admin' },
      { email: 'r@towncore.net', name: 'R', role: 'reviewer' },
    ])
    .returning()) as [StaffMember, StaffMember];
});
afterAll(async () => drop());

describe('funnel rates', () => {
  it('derives rates and the owner’s advice from counts', () => {
    const c = emptyCounts();
    expect(funnelRates(c)).toMatchObject({
      subscribersPer1k: null,
      claimRate: null,
      trialToPaid: null,
      advice: [],
    });
    Object.assign(c, {
      towns: 1,
      households: 1000,
      subscribersInHouseholdTowns: 5,
      listings: 100,
      claimed: 1,
      trialsEnded: 4,
      trialsConverted: 0,
    });
    expect(funnelRates(c).advice).toEqual(['traffic', 'claims', 'trials']);
  });
});

describe('townAudience', () => {
  it('counts subscribers per 1,000 households, sign-ups by prompt, referrals, claims and trials', async () => {
    await db.insert(sources).values({
      townId: oneId,
      key: 'meetings',
      kind: 'agenda',
      platform: 'legistar',
      adapter: 'legistar',
    });
    const sub = (email: string, source: string, status: 'active' | 'pending', at: Date) => ({
      townId: oneId,
      email,
      status,
      source,
      consentAt: at,
      consentSource: 'https://one.test/',
      confirmedAt: status === 'active' ? at : null,
    });
    await db
      .insert(subscribers)
      .values([
        sub('a@example.com', 'signup_form:home', 'active', day(3)),
        sub('b@example.com', 'signup_form:second-article', 'active', day(2)),
        sub('c@example.com', 'signup_form:second-article', 'pending', day(1)),
        sub('d@example.com', 'signup_form', 'active', day(60)),
      ]);
    const [story] = await db
      .insert(articles)
      .values({
        townId: oneId,
        slug: 's',
        headline: 'S',
        bodyMd: 'Body.',
        beat: 'government',
        tier: 2,
        status: 'published',
        byline: 'one Square Newsroom',
        sourceRecordIds: ['00000000-0000-4000-8000-000000000001'],
        publishedAt: day(5),
      })
      .returning();
    await db
      .insert(articleStatsDaily)
      .values({ articleId: story!.id, townId: oneId, day: ymd(day(1)), views: 10 });
    for (const source of ['facebook', 'facebook', 'newsletter', 'search'] as const)
      await countReferral(db, oneId, ymd(day(1)), source);
    await countReferral(db, oneId, ymd(day(45)), 'search'); // outside the window
    // Three listings, one claimed; two businesses with a first featured spot each.
    const biz = await db
      .insert(businesses)
      .values(
        ['x', 'y', 'z'].map((slug, i) => ({
          townId: oneId,
          slug,
          name: slug,
          category: 'restaurants',
          licenseVerified: true,
          dataSource: 'test',
          active: true,
          claimedAt: i === 0 ? day(50) : null,
        })),
      )
      .returning();
    await db.insert(stripePrices).values({
      townId: oneId,
      product: 'sponsored_slot',
      rank: 1,
      stripeProductId: 'prod_1',
      stripePriceId: 'price_1',
      unitAmountCents: 1900,
    } as typeof stripePrices.$inferInsert);
    const spot = (businessId: string, startsAt: Date, status: 'active' | 'canceled') => ({
      businessId,
      townId: oneId,
      product: 'sponsored_slot' as const,
      category: 'restaurants',
      rank: 1,
      stripePriceId: 'price_1',
      startsAt,
      endsAt: status === 'canceled' ? new Date(startsAt.getTime() + 10 * 86_400_000) : null,
      status,
    });
    // x: trial 45 days ago, still active → converted and paying. y: trial ended in 10 days.
    // z: a trial started 5 days ago, still free.
    await db
      .insert(placements)
      .values([
        spot(biz[0]!.id, day(45), 'active'),
        spot(biz[1]!.id, day(50), 'canceled'),
        spot(biz[2]!.id, day(5), 'active'),
      ]);

    const rows = await townAudience(db, NOW);
    const one = rows.find((r) => r.id === oneId)!;
    expect(one.platform).toBe('legistar');
    expect(one.counts.subscribers).toBe(3);
    expect(one.rates.subscribersPer1k).toBe(1.5);
    expect(one.counts.signups).toMatchObject({ home: 1, 'second-article': 2, other: 0 });
    expect(one.counts.views).toBe(10);
    expect(one.counts.referrals).toMatchObject({ facebook: 2, newsletter: 1, search: 1 });
    expect(one.rates.newsletterShare).toBe(0.1);
    expect(one.counts).toMatchObject({ listings: 3, claimed: 1, trialStarts: 1 });
    expect(one.counts).toMatchObject({ trialsEnded: 2, trialsConverted: 1, mrrCents: 1900 });
    expect(one.rates.trialToPaid).toBe(0.5);
    expect(one.rates.revenuePerTown).toBe(19);

    const two = rows.find((r) => r.id === twoId)!;
    expect(two.householdsKnown).toBe(false);
    expect(two.rates.subscribersPer1k).toBeNull();

    const cohorts = groupAudience(rows, byCohort);
    expect(cohorts.map((g) => g.key)).toEqual(['2026-09', 'not live']);
    const platforms = groupAudience(rows, byPlatform);
    expect(platforms.find((g) => g.key === 'legistar')!.rates.subscribersPer1k).toBe(1.5);
    expect(platforms.find((g) => g.key === 'none')!.counts.towns).toBe(1);
  });
});

describe('experiments', () => {
  it('records each town’s variant, compares them, and rolls the winner out everywhere', async () => {
    await expect(
      startExperiment(db, { key: 'signup-prompt', unit: 'town', staff: reviewer }, NOW),
    ).rejects.toThrow(ExperimentRefused);
    await expect(
      startExperiment(db, { key: 'nope', unit: 'town', staff: admin }, NOW),
    ).rejects.toThrow('No experiment');

    expect(await townVariant(db, 'signup-prompt', { id: oneId, cohort: '2026-09' })).toBe(
      'control',
    );
    const { assigned } = await startExperiment(
      db,
      { key: 'signup-prompt', unit: 'town', staff: admin },
      NOW,
    );
    expect(assigned).toBe(2);
    // Pin town one to the other variant, as if it had been assigned that way.
    await db
      .update(experimentAssignments)
      .set({ variant: 'local-news' })
      .where(eq(experimentAssignments.townId, oneId));
    expect(await townVariant(db, 'signup-prompt', { id: oneId, cohort: '2026-09' })).toBe(
      'local-news',
    );

    const reports = await experimentReports(db, await townAudience(db, NOW));
    const report = reports.find((r) => r.key === 'signup-prompt')!;
    expect(report.state.status).toBe('running');
    const local = report.variants.find((v) => v.variant === 'local-news')!;
    expect(local.towns).toBeGreaterThanOrEqual(1);
    expect(local.value).toBe(1.5);
    expect(reports.find((r) => r.key === 'module-order')!.state.status).toBe('off');

    await expect(
      decideExperiment(db, { key: 'signup-prompt', winner: 'nope', staff: admin }, NOW),
    ).rejects.toThrow('not a variant');
    await decideExperiment(db, { key: 'signup-prompt', winner: 'local-news', staff: admin }, NOW);
    expect(await townVariant(db, 'signup-prompt', { id: twoId, cohort: null })).toBe('local-news');
    await expect(
      decideExperiment(db, { key: 'signup-prompt', winner: 'control', staff: admin }, NOW),
    ).rejects.toThrow('running');

    await stopExperiment(db, { key: 'signup-prompt', staff: admin }, NOW);
    expect(await townVariant(db, 'signup-prompt', { id: twoId, cohort: null })).toBe('control');
    const actions = (await db.select().from(adminActions)).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['experiment.start', 'experiment.decide', 'experiment.stop']),
    );
  });
});
