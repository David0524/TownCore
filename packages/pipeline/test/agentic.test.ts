import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  adapterFixRequests,
  adminActions,
  articles,
  eq,
  experimentAssignments,
  experiments,
  mailDomains,
  opsDigests,
  proposals,
  sources,
  staff,
  subscribers,
  towns,
  type Db,
  type StaffMember,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cohortGates } from '../src/cohort-gates';
import { buildDigest, digestText, storeDigest } from '../src/digest';
import type { EvalSummary, VariantReport } from '../src/evals';
import {
  decideProposal,
  experimentProposals,
  ProposalDecisionRefused,
  routingDiff,
  routingProposals,
  runLearningLoops,
  upsertProposal,
} from '../src/proposals';

// Learning loops and the ops digest (docs/plans/agentic-ops.md): proposals written on a
// schedule and decided in one click; the cohort gates; the daily digest built in code.

const NOW = new Date('2026-10-17T09:40:00Z');
let db: Db;
let drop: () => Promise<void>;
let admin: StaffMember;
let reviewer: StaffMember;
const townIds: string[] = [];

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
  admin = a!;
  reviewer = r!;
  // Ten live towns in cohort 2026-11: five on each variant of the sign-up prompt experiment.
  await db.insert(experiments).values({ key: 'signup-prompt', status: 'running', startedAt: NOW });
  for (let i = 0; i < 10; i++) {
    const [t] = await db
      .insert(towns)
      .values({
        slug: `t${i}`,
        name: `T${i}`,
        state: 'FL',
        county: 'X',
        timezone: 'America/New_York',
        domain: `t${i}.test`,
        siteName: `T${i} Daily`,
        tier: 'small',
        status: 'live',
        cohort: '2026-11',
        households: 1000,
        config: {},
      })
      .returning();
    townIds.push(t!.id);
    const variant = i < 5 ? 'control' : 'local-news';
    await db
      .insert(experimentAssignments)
      .values({ experimentKey: 'signup-prompt', townId: t!.id, variant });
    const subs = variant === 'control' ? 2 : 4;
    for (let s = 0; s < subs; s++)
      await db.insert(subscribers).values({
        townId: t!.id,
        email: `r${s}@t${i}.example`,
        status: 'active',
        consentAt: new Date(NOW.getTime() - 86_400_000),
        confirmedAt: new Date(NOW.getTime() - 86_400_000),
        source: 'home',
      });
  }
});
afterAll(async () => drop());

describe('experiment winners', () => {
  it('proposes a variant that clearly beats the control, and approval rolls it out', async () => {
    const [p] = await experimentProposals(db, NOW);
    expect(p).toMatchObject({ kind: 'experiment', key: 'experiment:signup-prompt:local-news' });
    expect(p!.summary).toMatch(/4\.00 .* in 5 towns, against 2\.00 for control in 5 \(\+100%\)/);
    expect(await upsertProposal(db, p!)).toBe('opened');
    expect(await upsertProposal(db, p!)).toBe('refreshed');
    const [row] = await db.select().from(proposals);
    await expect(
      decideProposal(db, { id: row!.id, staff: reviewer, decision: 'approve' }, NOW),
    ).rejects.toThrow(ProposalDecisionRefused);
    await decideProposal(
      db,
      { id: row!.id, staff: admin, decision: 'approve', note: 'Clear win' },
      NOW,
    );
    const [exp] = await db.select().from(experiments);
    expect(exp).toMatchObject({ status: 'decided', winner: 'local-news' });
    expect((await db.select().from(adminActions)).map((a) => a.action).sort()).toEqual([
      'experiment.decide',
      'proposal.approve',
    ]);
    // Decided once: never proposed again under the same key.
    expect(await upsertProposal(db, p!)).toBe('decided');
  });
});

const summary = (passRate: number, unsupported: number, safety = 0): EvalSummary => ({
  cases: 20,
  passed: 20 - safety,
  safetyFailures: safety,
  factcheckPassRate: passRate,
  verbatimQuoteRate: 1,
  results: [
    {
      id: 'c',
      skip: null,
      tier: 1,
      status: 'published',
      factcheckScore: 1,
      claims: 10,
      verbatimClaims: 10 - unsupported,
      failures: [],
    },
  ],
});
const report = (variant: string, s: EvalSummary, costUsd: number): VariantReport => ({
  variant,
  provider: 'anthropic',
  ranAt: '2026-10-16T10:00:00Z',
  summary: s,
  costUsd,
  calls: 40,
});

describe('model routing from evals', () => {
  it('proposes a variant only when it is no worse on safety and better on quality or cost', () => {
    expect(
      routingProposals([
        report('baseline', summary(0.8, 2), 1),
        report('writer-thinking', summary(0.9, 1), 1.5),
        report('classify-sonnet', summary(0.95, 0, 1), 1.2),
      ]).map((p) => p.key),
    ).toEqual(['routing:anthropic:writer-thinking:2026-10-16T10:00:00Z']);
    expect(routingProposals([report('baseline', summary(0.8, 2), 1)])).toEqual([]);
    expect(routingDiff('writer-thinking')).toContain(
      'taskRoutes.write.thinking: "off" → "adaptive"',
    );
  });
});

describe('cohort gates and the learning run', () => {
  it('passes or fails each gate from the data there is, unknown for Search Console', async () => {
    const [gate] = await cohortGates(db, NOW);
    expect(gate!.cohort).toBe('2026-11');
    const byName = Object.fromEntries(gate!.gates.map((g) => [g.gate, g.status]));
    expect(byName['Zero manual actions']).toBe('unknown');
    expect(byName['Newsletter sign-ups coming in']).toBe('pass');
    expect(byName['Steady fact-check pass rate']).toBe('unknown');
    expect(gate!.verdict).toBe('launch');
  });

  it('writes the gate as a proposal and supersedes it when the verdict changes', async () => {
    const variants = mkdtempSync(join(tmpdir(), 'variants-'));
    mkdirSync(variants, { recursive: true });
    writeFileSync(
      join(variants, 'baseline.json'),
      JSON.stringify(report('baseline', summary(0.8, 2), 1)),
    );
    writeFileSync(
      join(variants, 'w.json'),
      JSON.stringify(report('writer-thinking', summary(0.9, 1), 1.5)),
    );
    const run = await runLearningLoops(db, { now: NOW, variantsDir: variants });
    expect(run.opened).toBe(2);
    const open = await db.select().from(proposals).where(eq(proposals.status, 'open'));
    expect(open.map((p) => p.kind).sort()).toEqual(['cohort_gate', 'routing']);
    const routing = open.find((p) => p.kind === 'routing')!;
    // A routing change is code: approving records it; nothing else changes.
    await decideProposal(db, { id: routing.id, staff: admin, decision: 'approve' }, NOW);
    // Sign-ups stop in all but one town (fewer than one a town): the gate fails.
    for (const id of townIds.slice(0, 9))
      await db.delete(subscribers).where(eq(subscribers.townId, id));
    await runLearningLoops(db, { now: NOW, variantsDir: variants });
    const gates = await db.select().from(proposals).where(eq(proposals.kind, 'cohort_gate'));
    expect(gates.map((g) => [g.key, g.status]).sort()).toEqual([
      ['cohort_gate:2026-11:launch', 'superseded'],
      ['cohort_gate:2026-11:pause', 'open'],
    ]);
  });
});

describe('the daily digest', () => {
  it('summarizes every area with an action and a link, built once a day', async () => {
    const [src] = await db
      .insert(sources)
      .values({
        townId: townIds[0]!,
        kind: 'agenda',
        platform: 'legistar',
        adapter: 'legistar',
        health: 'broken',
      })
      .returning();
    await db.insert(adapterFixRequests).values({
      scope: 'source',
      sourceId: src!.id,
      townId: townIds[0]!,
      platform: 'legistar',
      failure: 'http_gone',
      error: 'HTTP 404',
      diagnosis: 'Moved',
    });
    await db.insert(articles).values({
      townId: townIds[0]!,
      slug: 'waiting',
      headline: 'Waiting',
      bodyMd: 'Body.',
      beat: 'public_safety',
      tier: 3,
      status: 'in_review',
      byline: 'T0 Daily Newsroom',
      sourceRecordIds: [],
      updatedAt: new Date(NOW.getTime() - 30 * 3_600_000),
    });
    await db.insert(mailDomains).values([
      { name: 't0.test', displayName: 'T0', status: 'live', bulkStatus: 'warming', warmupDay: 3 },
      {
        name: 't1.test',
        displayName: 'T1',
        status: 'live',
        bulkStatus: 'paused',
        pausedReason: 'bounces 5%',
      },
    ]);
    const digest = await buildDigest(db, NOW);
    const of = (section: string) => digest.items.filter((i) => i.section === section);
    expect(
      of('Cohorts and Google')
        .map((i) => i.text)
        .join(' '),
    ).toMatch(/Search Console is not connected yet/);
    expect(of('Sources')[0]).toMatchObject({ severity: 'critical', link: '/admin/fixes' });
    expect(of('Sources')[0]!.text).toMatch(/1 broken source\(s\); 1 open fix request/);
    expect(of('Review queue')[0]).toMatchObject({ severity: 'warning' });
    expect(of('Review queue')[0]!.text).toMatch(/1 story waits in review; the oldest for 30 hours/);
    expect(of('Mail')[0]).toMatchObject({ severity: 'critical' });
    expect(of('Mail')[0]!.action).toMatch(/t1\.test paused/);
    expect(of('AI cost')[0]!.text).toMatch(/of the \$\d+\.00 network cap/);
    expect(of('Proposals')[0]!.text).toMatch(/1 proposal\(s\) wait: 1 cohort gate/);
    expect(digest.items.every((i) => i.action && i.link.startsWith('/admin/'))).toBe(true);
    const text = digestText(digest.date, digest.items, 'https://admin.towncore.net');
    expect(text).toMatch(/^TownCore daily digest, 2026-10-17/);
    expect(text).toContain('https://admin.towncore.net/admin/fixes');

    const first = await storeDigest(db, NOW);
    const second = await storeDigest(db, NOW);
    expect([first.created, second.created]).toEqual([true, false]);
    expect(await db.select().from(opsDigests)).toHaveLength(1);
  });
});
