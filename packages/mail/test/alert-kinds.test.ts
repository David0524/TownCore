import { describe, expect, it } from 'vitest';
import {
  BACKLOG_REPEAT_MS,
  backlogTrend,
  BREAKAGE_REPEAT_MS,
  deepAndGrowing,
  emailDue,
} from '../src/ops/alert-kinds';

// Alert kinds (ported from Kyle's anomaly rules): what gets emailed, and how often.

const now = new Date('2026-10-19T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const HOUR = 3_600_000;

describe('emailDue', () => {
  it('emails breakage when it opens and every 24 hours while open (the default)', () => {
    expect(emailDue(undefined, null, now)).toBe(true);
    expect(emailDue({ kind: 'breakage' }, null, now)).toBe(true);
    expect(emailDue({ kind: 'breakage' }, ago(23 * HOUR), now)).toBe(false);
    expect(emailDue({}, ago(BREAKAGE_REPEAT_MS), now)).toBe(true);
  });

  it('never emails a standing fact', () => {
    expect(emailDue({ kind: 'standing' }, null, now)).toBe(false);
    expect(emailDue({ kind: 'standing' }, ago(30 * 24 * HOUR), now)).toBe(false);
  });

  it('emails a backlog only when deep and growing, at most weekly', () => {
    const deep = { kind: 'backlog' as const, backlog: { depth: 12, ceiling: 10, weekAgo: 8 } };
    expect(emailDue(deep, null, now)).toBe(true);
    expect(emailDue(deep, ago(6 * 24 * HOUR), now)).toBe(false);
    expect(emailDue(deep, ago(BACKLOG_REPEAT_MS), now)).toBe(true);
    // Deep but draining, or growing but shallow: not worth an email.
    const draining = { ...deep, backlog: { depth: 12, ceiling: 10, weekAgo: 12 } };
    expect(emailDue(draining, null, now)).toBe(false);
    const shallow = { ...deep, backlog: { depth: 9, ceiling: 10, weekAgo: 1 } };
    expect(emailDue(shallow, null, now)).toBe(false);
    // A backlog without numbers can't be judged deep or growing.
    expect(emailDue({ kind: 'backlog' }, null, now)).toBe(false);
  });
});

describe('backlog helpers', () => {
  it('deep and growing', () => {
    expect(deepAndGrowing({ depth: 10, ceiling: 10, weekAgo: 9 })).toBe(true);
    expect(deepAndGrowing({ depth: 10, ceiling: 10, weekAgo: 10 })).toBe(false);
  });

  it('describes the week', () => {
    expect(backlogTrend({ depth: 12, weekAgo: 8 })).toBe('+4 this week');
    expect(backlogTrend({ depth: 6, weekAgo: 8 })).toBe('−2 this week');
    expect(backlogTrend({ depth: 8, weekAgo: 8 })).toBe('flat this week');
  });
});
