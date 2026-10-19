import {
  storyCandidates,
  articles,
  skippedCandidates,
  staff,
  adminActions,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bandFor,
  bandRows,
  calibrate,
  outcomeOf,
  scoreCalibration,
  type CandidateOutcome,
} from '../src/calibration';

// Score calibration (ported from Kyle's quality math): does the newsworthiness score predict
// what reviewers decide?

const o = (
  score: number,
  outcome: CandidateOutcome['outcome'],
  reviewerApproved = false,
): CandidateOutcome => ({ score, outcome, reviewerApproved });
const many = (n: number, item: CandidateOutcome) => Array.from({ length: n }, () => item);

describe('bands', () => {
  it('puts scores in 0–39, 40–59, 60–74, 75–89 and 90+', () => {
    expect([0, 39.9, 40, 59, 60, 74.5, 75, 89, 90, 100, 120].map(bandFor)).toEqual([
      '0-39',
      '0-39',
      '40-59',
      '40-59',
      '60-74',
      '60-74',
      '75-89',
      '75-89',
      '90+',
      '90+',
      '90+',
    ]);
    expect(bandFor(Number.NaN)).toBe('0-39');
    expect(bandFor(-5)).toBe('0-39');
  });

  it('counts and rates each band', () => {
    const rows = bandRows([
      o(95, 'published'),
      o(92, 'published', true),
      o(91, 'rejected'),
      o(90, 'open'),
      o(45, 'skipped'),
      o(41, 'skipped'),
      o(50, 'published', true),
    ]);
    expect(rows.map((r) => r.label)).toEqual(['0–39', '40–59', '60–74', '75–89', '90+']);
    const top = rows.find((r) => r.band === '90+')!;
    expect(top).toMatchObject({
      candidates: 4,
      published: 2,
      approved: 1,
      rejected: 1,
      skipped: 0,
      open: 1,
      publishRate: 0.5,
      rejectRate: 0.25,
      skipRate: 0,
      approvalRate: 0.5,
    });
    const mid = rows.find((r) => r.band === '40-59')!;
    expect(mid).toMatchObject({ candidates: 3, skipped: 2, approvalRate: 1 });
    expect(mid.skipRate).toBeCloseTo(2 / 3);
    const empty = rows.find((r) => r.band === '0-39')!;
    expect(empty).toMatchObject({ candidates: 0, publishRate: null, approvalRate: null });
  });
});

describe('calibrate', () => {
  it('waits for enough review decisions', () => {
    const c = calibrate([...many(5, o(95, 'published', true)), ...many(5, o(45, 'rejected'))]);
    expect(c.verdict).toBe('no-data');
    expect(c.decided).toBe(10);
    expect(c.headline).toContain('10 of 40');
  });

  it('says the score works when higher bands are approved more often', () => {
    const c = calibrate([
      ...many(4, o(45, 'published', true)),
      ...many(12, o(45, 'rejected')),
      ...many(8, o(65, 'published', true)),
      ...many(8, o(65, 'rejected')),
      ...many(12, o(92, 'published', true)),
      ...many(4, o(92, 'rejected')),
      // Skips and auto-published stories aren't reviewer decisions.
      ...many(30, o(20, 'skipped')),
      ...many(30, o(80, 'published')),
    ]);
    expect(c.decided).toBe(48);
    expect(c.verdict).toBe('working');
    expect(c.lift).toBeCloseTo(3);
    expect(c.monotonicity).toBe(1);
    expect(c.headline).toBe(
      "The score predicts reviewers' decisions: 90+ is approved 75% of the time, 40–59 25%.",
    );
  });

  it('says so when it does not', () => {
    const c = calibrate([
      ...many(10, o(45, 'published', true)),
      ...many(10, o(45, 'rejected')),
      ...many(10, o(92, 'published', true)),
      ...many(10, o(92, 'rejected')),
    ]);
    expect(c.verdict).toBe('broken');
    expect(c.lift).toBe(1);
  });

  it('reads each candidate’s outcome', () => {
    expect(
      outcomeOf({ candidateStatus: 'written', skipped: false, articleStatus: 'published' }),
    ).toBe('published');
    expect(
      outcomeOf({ candidateStatus: 'written', skipped: false, articleStatus: 'corrected' }),
    ).toBe('published');
    expect(
      outcomeOf({ candidateStatus: 'written', skipped: false, articleStatus: 'rejected' }),
    ).toBe('rejected');
    // Skipped, then written anyway: the article decides.
    expect(
      outcomeOf({ candidateStatus: 'written', skipped: true, articleStatus: 'in_review' }),
    ).toBe('open');
    expect(outcomeOf({ candidateStatus: 'skipped', skipped: true, articleStatus: null })).toBe(
      'skipped',
    );
    expect(
      outcomeOf({ candidateStatus: 'written', skipped: false, articleStatus: 'blocked' }),
    ).toBe('other');
    expect(outcomeOf({ candidateStatus: 'pending', skipped: false, articleStatus: null })).toBe(
      'open',
    );
  });
});

describe('scoreCalibration (from the database)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  const NOW = new Date('2026-10-19T12:00:00Z');
  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
  });
  afterAll(async () => drop());

  it('joins candidates, articles, skips and review approvals', async () => {
    const [town] = await db
      .insert(towns)
      .values({
        slug: 'calib',
        name: 'Calib',
        state: 'ZZ',
        county: 'Sample',
        timezone: 'America/New_York',
        domain: 'calib.test',
        siteName: 'Calib Square',
        status: 'live',
        tier: 'small',
        config: {},
      })
      .returning();
    const [editor] = await db
      .insert(staff)
      .values({ email: 'ed@towncore.net', name: 'Ed', role: 'reviewer' })
      .returning();
    const candidate = async (
      key: string,
      score: number | null,
      status: 'written' | 'skipped',
      kind: 'story' | 'roundup' = 'story',
      at = NOW,
    ) => {
      const [c] = await db
        .insert(storyCandidates)
        .values({
          townId: town!.id,
          key,
          recordIds: [],
          beat: 'government',
          proposedTier: 2,
          newsworthiness: score,
          status,
          kind,
          createdAt: at,
        })
        .returning();
      return c!;
    };
    const article = async (
      candidateId: string,
      slug: string,
      status: 'published' | 'rejected',
      reviewer: boolean,
    ) => {
      const [a] = await db
        .insert(articles)
        .values({
          townId: town!.id,
          slug,
          headline: slug,
          bodyMd: 'Body.',
          beat: 'government',
          tier: 3,
          status,
          byline: 'Calib Square Newsroom',
          sourceRecordIds: ['00000000-0000-4000-8000-000000000001'],
          candidateId,
          publishedAt: status === 'published' ? NOW : null,
        })
        .returning();
      if (reviewer)
        await db.insert(adminActions).values({
          staffId: editor!.id,
          action: status === 'published' ? 'approve' : 'reject',
          articleId: a!.id,
        });
    };
    await article((await candidate('a', 95, 'written')).id, 'a', 'published', true);
    await article((await candidate('b', 93, 'written')).id, 'b', 'rejected', true);
    await article((await candidate('c', 80, 'written')).id, 'c', 'published', false);
    const skipped = await candidate('d', 30, 'skipped');
    await db
      .insert(skippedCandidates)
      .values({ candidateId: skipped.id, reason: 'below_threshold' });
    // Not counted: a roundup, an unscored candidate, and one from long ago.
    await candidate('e', 99, 'written', 'roundup');
    await candidate('f', null, 'written');
    await candidate('g', 99, 'written', 'story', new Date('2026-01-01T00:00:00Z'));

    const c = await scoreCalibration(db, NOW);
    const by = Object.fromEntries(c.bands.map((b) => [b.band, b]));
    expect(by['90+']).toMatchObject({ candidates: 2, published: 1, approved: 1, rejected: 1 });
    expect(by['75-89']).toMatchObject({ candidates: 1, published: 1, approved: 0 });
    expect(by['0-39']).toMatchObject({ candidates: 1, skipped: 1, skipRate: 1 });
    expect(c.verdict).toBe('no-data');
    expect(c.days).toBe(90);
  });
});
