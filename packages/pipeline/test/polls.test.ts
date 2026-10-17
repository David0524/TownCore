import { adminActions, pollVotes, staff, towns, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activePoll,
  castVote,
  createPoll,
  decidePoll,
  PollError,
  pollShares,
  voterHash,
} from '../src/polls';

// Quick polls (owner, 2026-10-17; docs/plans/facebook.md §6).

let db: Db;
let drop: () => Promise<void>;
let townId: string;
let otherTownId: string;
let staffId: string;

const town = (slug: string) => ({
  slug,
  name: slug,
  state: 'ZZ',
  county: 'Sample',
  timezone: 'America/New_York',
  domain: `${slug}.test`,
  siteName: `${slug} Square`,
  status: 'live' as const,
  tier: 'small' as const,
  config: {},
});

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  const [a] = await db.insert(towns).values(town('polltown')).returning();
  const [b] = await db.insert(towns).values(town('othertown')).returning();
  townId = a!.id;
  otherTownId = b!.id;
  const [member] = await db
    .insert(staff)
    .values({ email: 'ed@towncore.net', name: 'Ed', role: 'reviewer' })
    .returning();
  staffId = member!.id;
});
afterAll(async () => drop());

const base = {
  question: 'Should the city add a farmers market on Sundays?',
  options: ['Yes', 'No', 'Not sure', ''],
  startsOn: '2026-10-17',
  endsOn: '2026-10-23',
};

describe('quick polls', () => {
  it('refuses bad polls', async () => {
    const make = (over: Partial<typeof base>) =>
      createPoll(db, { townId, staffId, ...base, ...over });
    await expect(make({ options: ['Yes'] })).rejects.toThrow(PollError);
    await expect(make({ options: ['Yes', 'yes'] })).rejects.toThrow('different');
    await expect(make({ question: 'See https://x.test for more' })).rejects.toThrow('links');
    await expect(make({ endsOn: '2026-10-16' })).rejects.toThrow('on or after');
    await expect(make({ endsOn: '2026-12-31' })).rejects.toThrow('at most');
    await expect(createPoll(db, { townId: 'nope', staffId, ...base })).rejects.toThrow(
      'Pick a town',
    );
  });

  it('shows only once approved, in town-local whole days, and counts one vote per address', async () => {
    const poll = await createPoll(db, { townId, staffId, ...base });
    expect(poll.status).toBe('draft');
    expect(poll.options).toEqual(['Yes', 'No', 'Not sure']);
    // Midnight in New York (EDT) to midnight after the last day.
    expect(poll.startsAt.toISOString()).toBe('2026-10-17T04:00:00.000Z');
    expect(poll.endsAt.toISOString()).toBe('2026-10-24T04:00:00.000Z');

    const during = new Date('2026-10-18T15:00:00Z');
    expect(await activePoll(db, townId, during)).toBeNull();
    expect(
      (await castVote(db, { townId, pollId: poll.id, option: 0, ip: '1.2.3.4', now: during }))
        .outcome,
    ).toBe('closed');

    await decidePoll(db, { pollId: poll.id, staffId, decision: 'approve', now: during });
    expect((await activePoll(db, townId, during))?.id).toBe(poll.id);
    expect(await activePoll(db, townId, new Date('2026-10-24T05:00:00Z'))).toBeNull();
    expect(await activePoll(db, otherTownId, during)).toBeNull();

    const vote = (ip: string | null, option: number, t = townId) =>
      castVote(db, { townId: t, pollId: poll.id, option, ip, now: during });
    expect((await vote('1.2.3.4', 0)).outcome).toBe('counted');
    expect((await vote('1.2.3.4', 1)).outcome).toBe('already');
    expect((await vote('5.6.7.8', 1)).outcome).toBe('counted');
    const last = await vote('9.9.9.9', 0);
    expect(last.results).toMatchObject({ counts: [2, 1, 0], total: 3 });
    expect(pollShares(last.results!)).toEqual([67, 33, 0]);
    // Another town's form can't vote on this poll; nor can a bad answer.
    expect((await vote('7.7.7.7', 0, otherTownId)).outcome).toBe('closed');
    await expect(vote('7.7.7.7', 3)).rejects.toThrow(PollError);

    // No raw address is stored, only a keyed hash.
    const stored = await db.select().from(pollVotes);
    expect(stored.some((v) => v.voterHash.includes('1.2.3.4'))).toBe(false);
    expect(stored.map((v) => v.voterHash)).toContain(voterHash(poll.id, '1.2.3.4'));
    expect(voterHash(poll.id, '1.2.3.4', 'a'.repeat(16))).not.toBe(
      voterHash(poll.id, '1.2.3.4', 'b'.repeat(16)),
    );

    await decidePoll(db, { pollId: poll.id, staffId, decision: 'withdraw' });
    expect(await activePoll(db, townId, during)).toBeNull();
    const audit = await db.select().from(adminActions);
    expect(audit.map((a) => a.action)).toEqual(['poll.create', 'poll.approve', 'poll.withdraw']);
  });
});
