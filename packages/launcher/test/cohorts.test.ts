import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchSteps } from '@towncore/config';
import {
  adminActions,
  eq,
  launchCohorts,
  launchCohortTowns,
  launches,
  launchStepRecords,
  mailDomains,
  staff,
  townCandidates,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  advanceCohort,
  approveCohortGoLive,
  approveCohortPurchase,
  CohortRefused,
  createCohort,
  listCohorts,
  parseAmount,
  retryCohortTown,
  runLaunch,
  setCohortPicks,
  type CohortDeps,
  type LaunchOptions,
  type LaunchResult,
} from '../src';

// The cohort orchestrator (docs/plans/agentic-ops.md): chaining, the one batch approval at a
// typed total, never buying twice, DNS conflicts as to-dos, resume after a crash, and go-live.
// The launch run, registrar and mail onboarding are fakes; nothing leaves the test.

const dir = mkdtempSync(join(tmpdir(), 'cohort-'));
const friction = join(dir, 'launch-friction.md');
let db: Db;
let drop: () => Promise<void>;
let admin: { id: string; role: 'admin' };
let reviewer: { id: string; role: 'reviewer' };

const PRICES: Record<string, number> = { delray: 11.25, jupiter: 12.5 };

/** Purchases the fake registrar received, by domain. */
const orders: string[] = [];
let crashOnPurchase = false;
let conflictFor: string | null = null;
let priceBump = 0;

/** A stand-in for runLaunch: same records, same stops, no network. */
async function fakeLaunch(
  opts: LaunchOptions,
  purchase?: {
    confirm: (q: { domain: string; price: number; renewalPrice: number }) => Promise<boolean>;
  },
): Promise<LaunchResult> {
  const name = opts.town.split(',')[0]!;
  const slug = name.toLowerCase().replace(/[^a-z]+/g, '-');
  const key = slug.split('-')[0]!;
  const [cand] = await db.select().from(townCandidates).where(eq(townCandidates.name, name));
  let [launch] = await db.select().from(launches).where(eq(launches.slug, slug));
  if (!launch) {
    [launch] = await db
      .insert(launches)
      .values({ candidateId: cand!.id, geoid: cand!.geoid, slug, name, state: 'FL' })
      .returning();
    await db
      .insert(launchStepRecords)
      .values(launchSteps.map((step) => ({ launchId: launch!.id, step })));
  }
  const step = async (s: string) =>
    (
      await db.select().from(launchStepRecords).where(eq(launchStepRecords.launchId, launch!.id))
    ).find((r) => r.step === s)!;
  const setStep = async (s: string, patch: Partial<typeof launchStepRecords.$inferInsert>) => {
    const row = await step(s);
    await db.update(launchStepRecords).set(patch).where(eq(launchStepRecords.id, row.id));
  };
  const proposals = [
    {
      siteName: `${name} Daily`,
      domain: `${key}daily.com`,
      blocked: [],
      review: [],
      quote: { available: true, price: PRICES[key]! + priceBump, renewalPrice: 15, premium: false },
    },
    {
      siteName: `${name} Local`,
      domain: `${key}local.com`,
      blocked: [],
      review: [],
      quote: { available: true, price: 20, renewalPrice: 20, premium: false },
    },
  ];
  const names = (await step('names')).detail as Record<string, unknown> | null;
  const stop = async (status: 'stopped' | 'ready', reason: string | null) => {
    [launch] = await db
      .update(launches)
      .set({ status, stoppedReason: reason })
      .where(eq(launches.id, launch!.id))
      .returning();
    return { launch: launch!, steps: [], files: [] };
  };
  if (opts.until === 'names') {
    if (!opts.pick) {
      if (!names)
        await setStep('names', { detail: { proposals, neighbors: [], manual: [], outlets: [] } });
      return stop('stopped', 'Pick a name');
    }
    const quotes = proposals.map((p) => ({ ...p, quote: { ...p.quote, price: p.quote.price } }));
    const chosen = quotes[opts.pick - 1]!;
    const detail: Record<string, unknown> = {
      ...(names ?? {}),
      proposals: quotes,
      picked: {
        siteName: chosen.siteName,
        domain: chosen.domain,
        townFile: join(dir, `${slug}.yaml`),
      },
    };
    if (opts.approveSpend) {
      const ok = await purchase!.confirm({
        domain: chosen.domain,
        price: chosen.quote.price,
        renewalPrice: 15,
      });
      if (ok) {
        if (crashOnPurchase) {
          orders.push(chosen.domain);
          throw new Error('worker died after sending the order');
        }
        orders.push(chosen.domain);
        detail.purchase = { orderId: `ord-${key}`, status: 'completed', price: chosen.quote.price };
      } else detail.purchase = { status: 'not bought', reason: 'the operator did not confirm' };
    } else detail.purchase = { status: 'not bought', reason: 'dry run (no --approve-spend)' };
    await setStep('names', { status: 'done', detail });
    return stop('stopped', 'Paused after names');
  }
  // Provisioning: the rest of the steps, then a draft town ready for review.
  const picked = (names as { picked: { siteName: string; domain: string } }).picked;
  await db
    .insert(towns)
    .values({
      slug,
      name,
      state: 'FL',
      county: 'Palm Beach',
      timezone: 'America/New_York',
      domain: picked.domain,
      siteName: picked.siteName,
      tier: 'mid',
      config: {},
      readinessScore: 1.2,
    })
    .onConflictDoNothing();
  for (const s of launchSteps)
    if (s !== 'names')
      await setStep(s, {
        status: 'done',
        detail:
          s === 'report'
            ? {
                passed: true,
                checks: [],
                manual: [
                  'Trademark: search the picked name at https://tmsearch.uspto.gov/ (D-M7-4).',
                  'Logo art: make it in ChatGPT.',
                ],
              }
            : {},
      });
  return stop('ready', null);
}

const onboarded: Array<{ name: string; execute: boolean }> = [];
async function fakeOnboard(spec: { name: string }, o: { execute: boolean }) {
  onboarded.push({ name: spec.name, execute: o.execute });
  if (conflictFor === spec.name)
    return {
      outcome: 'failed' as const,
      error: 'DNS conflict, nothing changed: MX exists',
      conflicts: [{ reason: 'an MX record for @ points elsewhere' }],
    };
  if (!o.execute) return { outcome: 'planned' as const, error: null, conflicts: [] };
  await db
    .insert(mailDomains)
    .values({ name: spec.name, displayName: spec.name, status: 'onboarding' })
    .onConflictDoNothing();
  return { outcome: 'waiting' as const, error: null, conflicts: [] };
}

const deps = (): CohortDeps => ({
  db,
  launch: fakeLaunch,
  onboard: fakeOnboard,
  frictionLog: friction,
  now: () => new Date('2026-10-17T12:00:00Z'),
});

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  const [a] = await db
    .insert(staff)
    .values({ email: 'owner@towncore.net', name: 'Owner', role: 'admin' })
    .returning();
  const [r] = await db
    .insert(staff)
    .values({ email: 'ed@towncore.net', name: 'Ed', role: 'reviewer' })
    .returning();
  admin = { id: a!.id, role: 'admin' };
  reviewer = { id: r!.id, role: 'reviewer' };
  await db.insert(townCandidates).values([
    {
      state: 'FL',
      geoid: '1217100',
      name: 'Delray Beach',
      inputs: {},
      score: 0.7,
      rank: 1,
      rankedAt: new Date(),
      status: 'approved',
    },
    {
      state: 'FL',
      geoid: '1235875',
      name: 'Jupiter',
      inputs: {},
      score: 0.6,
      rank: 2,
      rankedAt: new Date(),
      status: 'approved',
    },
    {
      state: 'FL',
      geoid: '1299999',
      name: 'Nowhere',
      inputs: {},
      score: 0.1,
      rank: 9,
      rankedAt: new Date(),
    },
  ]);
});
afterAll(async () => drop());

const candidateIds = async (...names: string[]) =>
  (await db.select().from(townCandidates)).filter((c) => names.includes(c.name)).map((c) => c.id);
const orderOf = (r: { detail: Record<string, unknown> }) =>
  (r.detail.purchase as { orderId?: string } | undefined)?.orderId;
const rowsOf = async (cohortId: string) =>
  db.select().from(launchCohortTowns).where(eq(launchCohortTowns.cohortId, cohortId));

describe('runLaunch until', () => {
  it('stops after the named step and keeps `until` out of the stored options', async () => {
    const tmp = await createTestDb();
    try {
      await tmp.db.insert(townCandidates).values({
        state: 'FL',
        geoid: '1217100',
        name: 'Delray Beach',
        inputs: {},
        score: 0.7,
        rank: 1,
        rankedAt: new Date(),
        status: 'approved',
      });
      const result = await runLaunch(
        {
          db: tmp.db,
          launchDir: dir,
          resolve: async () => ({
            slug: 'delray-beach',
            name: 'Delray Beach',
            state: 'FL',
            censusId: '1217100',
            censusName: 'Delray Beach city',
            county: 'Palm Beach',
            timezone: 'America/New_York',
            tier: 'mid',
            population2025: 69809,
            lat: 26.45,
            lon: -80.09,
            nws: { zone: 'FLZ068', office: 'MFL', point: '26.4500,-80.0900' },
            sameNameElsewhere: [],
            agencies: ['City of Delray Beach'],
          }),
        },
        { town: 'Delray Beach, FL', until: 'resolve' },
      );
      expect(result.launch.status).toBe('stopped');
      expect(result.launch.stoppedReason).toMatch(/Paused after 1\. Resolve the town/);
      expect(result.launch.options).not.toHaveProperty('until');
      expect(result.steps.map((s) => s.status)).toEqual([
        'done',
        ...Array(launchSteps.length - 1).fill('pending'),
      ]);
    } finally {
      await tmp.drop();
    }
  });
});

describe('a launch cohort', () => {
  let cohortId: string;

  it('starts only from approved towns, by an admin', async () => {
    await expect(
      createCohort(db, {
        name: '2026-11',
        candidateIds: await candidateIds('Delray Beach'),
        staff: reviewer,
        dryRun: false,
      }),
    ).rejects.toThrow(CohortRefused);
    await expect(
      createCohort(db, {
        name: '2026-11',
        candidateIds: await candidateIds('Nowhere'),
        staff: admin,
        dryRun: false,
      }),
    ).rejects.toThrow(/approved in the ranked list/);
    const cohort = await createCohort(db, {
      name: '2026-11',
      candidateIds: await candidateIds('Delray Beach', 'Jupiter'),
      staff: admin,
      dryRun: false,
    });
    cohortId = cohort.id;
    expect(cohort).toMatchObject({ status: 'preparing', dryRun: false });
  });

  it('proposes names and prices, then waits for the one purchase approval', async () => {
    expect(await advanceCohort(deps(), cohortId)).toBe(true);
    const rows = await rowsOf(cohortId);
    expect(rows.map((r) => [r.stage, r.state])).toEqual([
      ['names', 'done'],
      ['names', 'done'],
    ]);
    const [cohort] = await listCohorts(db);
    expect(cohort!.status).toBe('awaiting_purchase');
    expect(cohort!.totalUsd).toBe(23.75);
    // Nothing is bought or onboarded before the approval.
    await advanceCohort(deps(), cohortId);
    expect(orders).toEqual([]);
    expect(onboarded).toEqual([]);
  });

  it('lets an admin change a pick, which changes the total', async () => {
    const jupiter = (await listCohorts(db))[0]!.towns.find((t) => t.name === 'Jupiter')!;
    await setCohortPicks(db, { cohortId, staff: admin, picks: { [jupiter.id]: 2 } });
    expect((await listCohorts(db))[0]!.totalUsd).toBe(31.25);
    await setCohortPicks(db, { cohortId, staff: admin, picks: { [jupiter.id]: 1 } });
  });

  it('needs an admin and the total typed back exactly', async () => {
    await expect(
      approveCohortPurchase(db, { cohortId, staff: reviewer, typedTotal: '23.75' }),
    ).rejects.toThrow(/Only an admin/);
    await expect(
      approveCohortPurchase(db, { cohortId, staff: admin, typedTotal: '23.00' }),
    ).rejects.toThrow(/Type the total exactly as shown \(\$23\.75\)/);
    expect(parseAmount('$1,023.75')).toBe(102375);
    expect(parseAmount('12.345')).toBeNull();
    const approval = await approveCohortPurchase(db, {
      cohortId,
      staff: admin,
      typedTotal: '$23.75',
    });
    expect(approval).toMatchObject({ totalUsd: 23.75, dryRun: false });
    expect(approval.domains.map((d) => [d.domain, d.price])).toEqual(
      expect.arrayContaining([
        ['delraydaily.com', 11.25],
        ['jupiterdaily.com', 12.5],
      ]),
    );
    const [audit] = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'cohort.purchase.approve'));
    expect(audit!.detail).toMatchObject({ totalUsd: 23.75 });
  });

  it('chains purchase → mail; a DNS conflict becomes a to-do, never an overwrite', async () => {
    conflictFor = 'jupiterdaily.com';
    await advanceCohort(deps(), cohortId);
    expect(orders.sort()).toEqual(['delraydaily.com', 'jupiterdaily.com']);
    expect(onboarded).toEqual(
      expect.arrayContaining([
        { name: 'delraydaily.com', execute: true },
        { name: 'jupiterdaily.com', execute: true },
      ]),
    );
    const rows = await rowsOf(cohortId);
    const delray = rows.find((r) => orderOf(r) === 'ord-delray')!;
    const jupiter = rows.find((r) => orderOf(r) === 'ord-jupiter')!;
    // Delray waits on SES verification (the worker's mail check takes it live).
    expect([delray.stage, delray.state]).toEqual(['dns', 'waiting']);
    expect([jupiter.stage, jupiter.state]).toEqual(['mail', 'failed']);
    expect(jupiter.todos[0]!.text).toMatch(/DNS conflict .* Nothing was overwritten/);
  });

  it('never buys twice when resumed, and retries a fixed conflict', async () => {
    conflictFor = null;
    const jupiter = (await rowsOf(cohortId)).find((r) => orderOf(r) === 'ord-jupiter')!;
    await retryCohortTown(db, { cohortTownId: jupiter.id, staff: admin });
    await advanceCohort(deps(), cohortId);
    await advanceCohort(deps(), cohortId);
    expect(orders).toHaveLength(2);
    expect((await rowsOf(cohortId)).map((r) => r.stage)).toEqual(['dns', 'dns']);
  });

  it('provisions once DNS verifies, then waits in review with batched to-dos', async () => {
    await db.update(mailDomains).set({ status: 'live' });
    await advanceCohort(deps(), cohortId);
    const rows = await rowsOf(cohortId);
    expect(rows.map((r) => [r.stage, r.state])).toEqual([
      ['review', 'waiting'],
      ['review', 'waiting'],
    ]);
    const todos = rows[0]!.todos.map((t) => t.key.split(':')[0]);
    expect(todos).toEqual(['trademark', 'logo', 'facebook', 'search-console']);
    expect(rows[0]!.todos.find((t) => t.key.startsWith('search-console'))!.text).toMatch(
      /Manual until a Google credential exists/,
    );
    expect((await db.select().from(launchCohorts))[0]!.status).toBe('awaiting_go_live');
    expect(readFileSync(friction, 'utf8')).toMatch(/cohort 2026-11/);
  });

  it('goes live in one admin click, with every go-live check re-run', async () => {
    await expect(approveCohortGoLive(db, { cohortId, staff: reviewer })).rejects.toThrow(
      /Only an admin/,
    );
    const { live, held } = await approveCohortGoLive(db, { cohortId, staff: admin });
    expect(live.sort()).toEqual(['Delray Beach Daily', 'Jupiter Daily']);
    expect(held).toEqual([]);
    expect((await db.select().from(towns)).every((t) => t.status === 'live')).toBe(true);
    expect((await db.select().from(launchCohorts))[0]!.status).toBe('live');
  });
});

describe('a cohort that stops on its way', () => {
  it('buys nothing when the price moved, and nothing twice after a crash', async () => {
    const t = await createTestDb();
    const outer = db;
    db = t.db;
    try {
      const [a] = await db
        .insert(staff)
        .values({ email: 'owner@towncore.net', name: 'Owner', role: 'admin' })
        .returning();
      const me = { id: a!.id, role: 'admin' as const };
      await db.insert(townCandidates).values([
        {
          state: 'FL',
          geoid: '1217100',
          name: 'Delray Beach',
          inputs: {},
          score: 0.7,
          rank: 1,
          rankedAt: new Date(),
          status: 'approved',
        },
        {
          state: 'FL',
          geoid: '1235875',
          name: 'Jupiter',
          inputs: {},
          score: 0.6,
          rank: 2,
          rankedAt: new Date(),
          status: 'approved',
        },
      ]);
      const cohort = await createCohort(db, {
        name: 'C2',
        candidateIds: (await db.select().from(townCandidates)).map((c) => c.id),
        staff: me,
        dryRun: false,
      });
      await advanceCohort(deps(), cohort.id);
      await approveCohortPurchase(db, { cohortId: cohort.id, staff: me, typedTotal: '23.75' });
      orders.length = 0;
      priceBump = 5;
      await advanceCohort(deps(), cohort.id);
      expect(orders).toEqual([]);
      const rows = await rowsOf(cohort.id);
      expect(
        rows.every((r) => r.state === 'failed' && /Nothing bought: .* now costs/.test(r.error!)),
      ).toBe(true);

      // A crash after sending an order: the next pass never sends it again.
      priceBump = 0;
      crashOnPurchase = true;
      for (const r of rows) await retryCohortTown(db, { cohortTownId: r.id, staff: me });
      await advanceCohort(deps(), cohort.id);
      const during = await rowsOf(cohort.id);
      expect(during.every((r) => r.state === 'running' && /worker died/.test(r.error!))).toBe(true);
      crashOnPurchase = false;
      const sent = [...orders];
      await advanceCohort(deps(), cohort.id);
      // Both orders went out before the error was recorded: neither is ever sent again.
      expect(orders).toEqual(sent);
      const after = await rowsOf(cohort.id);
      expect(
        after.every(
          (r) =>
            r.state === 'failed' && /a purchase is never sent twice/.test(r.todos.at(-1)!.text),
        ),
      ).toBe(true);
    } finally {
      db = outer;
      await t.drop();
    }
  });

  it('runs a dry-run cohort through planning without buying or changing DNS', async () => {
    const t = await createTestDb();
    const outer = db;
    db = t.db;
    try {
      const [a] = await db
        .insert(staff)
        .values({ email: 'owner@towncore.net', name: 'Owner', role: 'admin' })
        .returning();
      const me = { id: a!.id, role: 'admin' as const };
      await db.insert(townCandidates).values({
        state: 'FL',
        geoid: '1217100',
        name: 'Delray Beach',
        inputs: {},
        score: 0.7,
        rank: 1,
        rankedAt: new Date(),
        status: 'approved',
      });
      const cohort = await createCohort(db, {
        name: 'Dry',
        candidateIds: (await db.select().from(townCandidates)).map((c) => c.id),
        staff: me,
        dryRun: true,
      });
      await advanceCohort(deps(), cohort.id);
      // A dry run needs no typed total.
      await approveCohortPurchase(db, { cohortId: cohort.id, staff: me, typedTotal: '' });
      orders.length = 0;
      onboarded.length = 0;
      await advanceCohort(deps(), cohort.id);
      expect(orders).toEqual([]);
      expect(onboarded).toEqual([{ name: 'delraydaily.com', execute: false }]);
      const [row] = await rowsOf(cohort.id);
      expect([row!.stage, row!.state]).toEqual(['review', 'waiting']);
      // Go-live still refuses: the domain was never bought.
      expect((row!.detail as { blockers: string[] }).blockers.join(' ')).toMatch(/not been bought/);
    } finally {
      db = outer;
      await t.drop();
    }
  });
});
