import { eq, mailDomains, onboardingSteps, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { STEPS, type IdentityInfo, type IdentityProvider } from '@towncore/mail';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMailTick } from '../src/mail';

let db: Db;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ db, drop } = await createTestDb());
});
afterAll(async () => drop());

const logger = pino({ level: 'silent' });

function ses(status: 'PENDING' | 'SUCCESS'): IdentityProvider & { writes: number } {
  const provider = {
    writes: 0,
    async getIdentity(name: string): Promise<IdentityInfo> {
      return {
        name,
        verificationStatus: status,
        dkimStatus: status,
        dkimTokens: ['a', 'b', 'c'],
        signingHostedZone: 'dkim.amazonses.com',
        mailFromDomain: `mail.${name}`,
        mailFromStatus: status,
        configurationSetName: null,
      };
    },
    async createIdentity(): Promise<IdentityInfo> {
      provider.writes++;
      throw new Error('the worker must never create identities');
    },
    async setMailFrom() {
      provider.writes++;
      throw new Error('the worker must never change identities');
    },
  };
  return provider;
}

async function waitingDomain(name: string) {
  const [row] = await db
    .insert(mailDomains)
    .values({ name, displayName: 'T', isTest: true, status: 'onboarding' })
    .returning();
  for (const step of STEPS.slice(0, STEPS.indexOf('verify')))
    await db
      .insert(onboardingSteps)
      .values({ domainId: row!.id, step, status: 'done', attempts: 1 });
  return row!;
}

describe('runMailTick', () => {
  it('takes waiting domains live once SES verifies, reading SES only', async () => {
    await waitingDomain('one.test');
    const pending = ses('PENDING');
    await runMailTick(db, pending, logger);
    let [row] = await db.select().from(mailDomains).where(eq(mailDomains.name, 'one.test'));
    expect(row!.status).toBe('onboarding');

    const verified = ses('SUCCESS');
    await runMailTick(db, verified, logger);
    [row] = await db.select().from(mailDomains).where(eq(mailDomains.name, 'one.test'));
    expect(row).toMatchObject({ status: 'live', inboundEnabled: true, bulkStatus: 'warming' });
    expect(pending.writes + verified.writes).toBe(0);
  });

  it('answers a re-check request on a live domain and clears it', async () => {
    await db
      .update(mailDomains)
      .set({ recheckRequestedAt: new Date() })
      .where(eq(mailDomains.name, 'one.test'));
    await runMailTick(db, ses('SUCCESS'), logger);
    const [row] = await db.select().from(mailDomains).where(eq(mailDomains.name, 'one.test'));
    expect(row!.recheckRequestedAt).toBeNull();
  });

  it('without AWS credentials, skips and keeps the request', async () => {
    await waitingDomain('two.test');
    await db
      .update(mailDomains)
      .set({ recheckRequestedAt: new Date() })
      .where(eq(mailDomains.name, 'two.test'));
    await runMailTick(db, null, logger);
    const [row] = await db.select().from(mailDomains).where(eq(mailDomains.name, 'two.test'));
    expect(row).toMatchObject({ status: 'onboarding' });
    expect(row!.recheckRequestedAt).not.toBeNull();
  });
});
