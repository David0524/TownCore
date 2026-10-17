import { opsDigests, staff, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { logTransport } from '@towncore/mail';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCohorts, runDigest } from '../src/agents';

// The ops digest leaves only for admins on the company domain, once a day, through the alert
// path (here the log transport: nothing is sent). Cohorts don't advance in the worker unless
// COHORT_ORCHESTRATOR=worker.

let db: Db;
let drop: () => Promise<void>;
const logger = pino({ level: 'silent' });
beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  await db.insert(staff).values([
    { email: 'owner@towncore.net', name: 'Owner', role: 'admin' },
    { email: 'ed@towncore.net', name: 'Ed', role: 'reviewer' },
    { email: 'outside@example.com', name: 'Outside', role: 'admin' },
  ]);
});
afterAll(async () => drop());

describe('the daily digest job', () => {
  it('stores it, emails company admins only, and never twice', async () => {
    const lines: string[] = [];
    const sent: Array<{ to: string[] }> = [];
    const log = logTransport((l) => lines.push(l));
    const transport = {
      ...log,
      send: async (m: Parameters<typeof log.send>[0]) => {
        sent.push({ to: m.to });
        return log.send(m);
      },
    };
    const now = new Date('2026-10-17T09:40:00Z');
    await runDigest(db, { transport, configurationSet: 'log' }, logger, now);
    await runDigest(db, { transport, configurationSet: 'log' }, logger, now);
    expect(sent).toEqual([{ to: ['owner@towncore.net'] }]);
    const [digest] = await db.select().from(opsDigests);
    expect(digest!.emailedAt).toEqual(now);
  });

  it('keeps the digest unsent while mail is not configured', async () => {
    const now = new Date('2026-10-18T09:40:00Z');
    await runDigest(db, null, logger, now);
    const rows = await db.select().from(opsDigests);
    expect(rows.find((r) => r.date === '2026-10-18')!.emailedAt).toBeNull();
  });
});

describe('launch cohorts in the worker', () => {
  it('do nothing unless COHORT_ORCHESTRATOR=worker (unset in tests)', async () => {
    // A fetcher that would fail if used: the job returns before building any launch deps.
    await expect(runCohorts(db, {} as never, undefined, logger)).resolves.toBeUndefined();
  });
});
