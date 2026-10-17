import {
  adminActions,
  eq,
  records,
  scoreReports,
  sources,
  staff,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decideScore,
  pendingScores,
  ScoreRejected,
  SCORES_PER_HOUR,
  submitScore,
} from '../src/scores';

// Reader scores (owner, 2026-10-17): structured, team-level reports wait for staff; approval
// writes a game record on the town's reader source; every decision is audited.

const NOW = new Date('2026-10-17T15:00:00Z');
let db: Db;
let drop: () => Promise<void>;
let townId: string;
let staffId: string;

const report = (over: Record<string, string> = {}) => ({
  townId,
  sport: 'Football',
  level: 'Varsity',
  home: 'Boca Raton',
  away: 'Spanish River',
  homeScore: '21',
  awayScore: '14',
  playedOn: '2026-10-16',
  venue: 'Boca Raton High School',
  localSide: 'both',
  name: 'Pat Reader',
  email: 'pat@example.com',
  ip: '203.0.113.5',
  now: NOW,
  ...over,
});

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  const [t] = await db
    .insert(towns)
    .values({
      slug: 'scoretown',
      name: 'Scoretown',
      state: 'ZZ',
      county: 'Sample',
      timezone: 'America/New_York',
      domain: 'scoretown.test',
      siteName: 'Scoretown Square',
      tier: 'small',
      config: {},
    })
    .returning();
  townId = t!.id;
  const [s] = await db
    .insert(staff)
    .values({ email: 'ed@towncore.net', name: 'Ed', role: 'reviewer' })
    .returning();
  staffId = s!.id;
});
afterAll(async () => drop());

describe('reader scores', () => {
  it('rejects bad reports with a reason code', async () => {
    const code = async (over: Record<string, string>) =>
      submitScore(db, report(over)).then(
        () => 'ok',
        (e: unknown) => (e instanceof ScoreRejected ? e.code : 'other'),
      );
    expect(await code({ sport: 'Golf' })).toBe('sport');
    expect(await code({ away: 'boca raton' })).toBe('teams');
    expect(await code({ homeScore: '2 1' })).toBe('score');
    expect(await code({ playedOn: '2026-09-01' })).toBe('date');
    expect(await code({ playedOn: '2026-10-20' })).toBe('date');
    expect(await code({ localSide: 'neither' })).toBe('local');
    expect(await code({ email: 'nope' })).toBe('contact');
  });

  it('waits for staff, then an approval writes a reader game record', async () => {
    const r = await submitScore(db, report());
    expect(r.status).toBe('pending');
    expect((await pendingScores(db)).map((p) => p.report.id)).toContain(r.id);
    expect(await db.select().from(records)).toHaveLength(0);

    const approved = await decideScore(db, {
      reportId: r.id,
      staffId,
      approve: true,
      away: 'Spanish River HS',
      now: NOW,
    });
    expect(approved).toMatchObject({ status: 'approved', away: 'Spanish River HS' });
    const [game] = await db.select().from(records).where(eq(records.id, approved.recordId!));
    expect(game).toMatchObject({ type: 'game', title: 'Boca Raton 21, Spanish River HS 14' });
    expect(game!.raw).toMatchObject({
      status: 'final',
      local: ['Boca Raton', 'Spanish River HS'],
      note: 'Score sent by a reader',
    });
    expect(JSON.stringify(game!.raw)).not.toContain('Pat');
    const [source] = await db.select().from(sources).where(eq(sources.id, game!.sourceId));
    expect(source).toMatchObject({ kind: 'sports', platform: 'reader', key: 'reader-scores' });
    await expect(
      decideScore(db, { reportId: r.id, staffId, approve: false, now: NOW }),
    ).rejects.toThrow(/already decided/);
    const log = await db.select().from(adminActions);
    expect(log.map((l) => l.action)).toEqual(['score.approve']);
  });

  it('rejects with a reason and limits each sender to a few an hour', async () => {
    const r = await submitScore(db, report({ email: 'other@example.com', ip: '198.51.100.1' }));
    const rejected = await decideScore(db, {
      reportId: r.id,
      staffId,
      approve: false,
      reason: 'Not a real game',
      now: NOW,
    });
    expect(rejected).toMatchObject({ status: 'rejected', rejectReason: 'Not a real game' });
    expect(rejected.recordId).toBeNull();
    for (let i = 0; i < SCORES_PER_HOUR; i++)
      await submitScore(db, report({ email: 'busy@example.com', ip: '192.0.2.9' }));
    await expect(
      submitScore(db, report({ email: 'busy@example.com', ip: '192.0.2.9' })),
    ).rejects.toThrow('rate');
    expect((await db.select().from(scoreReports)).length).toBe(2 + SCORES_PER_HOUR);
  });
});
