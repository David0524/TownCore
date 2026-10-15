import {
  eq,
  mailDomains,
  mailEvents,
  messages,
  onboardingSteps,
  suppressions,
  syncMailRouting,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { STEPS, type IdentityInfo, type IdentityProvider } from '@towncore/mail';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMailTick, startInboundLoop } from '../src/mail';

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

describe('inbound loop', () => {
  it('drains stored SNS notifications into conversations', async () => {
    await syncMailRouting(db);
    await db.insert(mailDomains).values({
      name: 'inbox.test',
      displayName: 'I',
      isTest: true,
      status: 'live',
      inboundEnabled: true,
    });
    const raw =
      'From: Pat <pat@example.com>\r\nTo: sales@inbox.test\r\nSubject: Hello\r\nMessage-ID: <m1@example.com>\r\n\r\nHi there';
    await db.insert(mailEvents).values({
      snsMessageId: 'sns-1',
      topicArn: 'arn:aws:sns:us-east-1:123456789012:inbound',
      type: 'Received',
      payload: {
        notificationType: 'Received',
        mail: { messageId: 'ses-1', source: 'pat@example.com' },
        receipt: {
          recipients: ['sales@inbox.test'],
          action: { type: 'S3', bucketName: 'bucket', objectKey: 'inbound/ses-1' },
        },
      },
    });
    const stop = startInboundLoop(
      db,
      {
        bucket: 'bucket',
        objects: { getRaw: async () => Buffer.from(raw), putAttachment: async () => {} },
      },
      logger,
      50,
    );
    try {
      const deadline = Date.now() + 10_000;
      let status = 'pending';
      while (status === 'pending' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        [{ status }] = (await db.select({ status: mailEvents.status }).from(mailEvents)) as [
          { status: string },
        ];
      }
      expect(status).toBe('done');
      const [message] = await db.select().from(messages).where(eq(messages.sesMessageId, 'ses-1'));
      expect(message).toMatchObject({ subject: 'Hello', envelopeRecipient: 'sales@inbox.test' });
    } finally {
      await stop();
    }
  });
});

describe('sending events', () => {
  it('a bounce event updates the sent message and suppresses the address', async () => {
    const [row] = await db
      .select({ threadId: messages.threadId })
      .from(messages)
      .where(eq(messages.sesMessageId, 'ses-1'));
    const [out] = await db
      .insert(messages)
      .values({
        threadId: row!.threadId,
        direction: 'outbound',
        fromAddress: 'sales@inbox.test',
        subject: 'Re: Hello',
        sesMessageId: 'out-ses-1',
        deliveryStatus: 'sent',
        sentAt: new Date(),
      })
      .returning();
    await db.insert(mailEvents).values({
      snsMessageId: 'sns-bounce-1',
      topicArn: 'arn:aws:sns:us-east-1:123456789012:conversational-events',
      type: 'Bounce',
      payload: {
        eventType: 'Bounce',
        mail: { messageId: 'out-ses-1', destination: ['nobody@example.com'] },
        bounce: {
          bounceType: 'Permanent',
          bounceSubType: 'NoEmail',
          bouncedRecipients: [{ emailAddress: 'nobody@example.com' }],
        },
      },
    });
    const stop = startInboundLoop(
      db,
      {
        bucket: 'bucket',
        objects: { getRaw: async () => Buffer.from(''), putAttachment: async () => {} },
      },
      logger,
      50,
    );
    try {
      const deadline = Date.now() + 10_000;
      let status: string | null = 'sent';
      while (status === 'sent' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        [{ status }] = (await db
          .select({ status: messages.deliveryStatus })
          .from(messages)
          .where(eq(messages.id, out!.id))) as [{ status: string | null }];
      }
      expect(status).toBe('bounced');
      expect(
        await db.select().from(suppressions).where(eq(suppressions.email, 'nobody@example.com')),
      ).toHaveLength(1);
    } finally {
      await stop();
    }
  });
});
