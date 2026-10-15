import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { eq, mailEvents, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  isSnsUrl,
  SnsVerificationError,
  stringToSign,
  verifySnsMessage,
  type SnsMessage,
} from '../src/sns';
import { handleSnsWebhook } from '../src/webhook';

// Real signatures over fixture messages, with a key pair made for the test run.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
const TOPIC = 'arn:aws:sns:us-east-1:123456789012:towncore-dev-inbound';
const CERT = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem';

const receivedNotification = {
  notificationType: 'Received',
  mail: { messageId: 'ses-msg-1', source: 'pat@example.com', destination: ['sales@testtown.com'] },
  receipt: {
    recipients: ['sales@testtown.com'],
    spamVerdict: { status: 'PASS' },
    virusVerdict: { status: 'PASS' },
    action: { type: 'S3', bucketName: 'bucket', objectKey: 'inbound/ses-msg-1', topicArn: TOPIC },
  },
};

function signed(
  fields: Partial<SnsMessage> = {},
  version: '1' | '2' = '2',
  key: KeyObject = privateKey,
): SnsMessage {
  const m = {
    Type: 'Notification',
    MessageId: `sns-${Math.random().toString(36).slice(2)}`,
    TopicArn: TOPIC,
    Message: JSON.stringify(receivedNotification),
    Timestamp: '2026-10-15T12:00:00.000Z',
    SignatureVersion: version,
    Signature: '',
    SigningCertURL: CERT,
    ...fields,
  } as SnsMessage;
  m.Signature = sign(
    version === '1' ? 'sha1' : 'sha256',
    Buffer.from(stringToSign(m)),
    key,
  ).toString('base64');
  return m;
}

const options = { allowedTopicArns: [TOPIC], loadSigningKey: async () => publicKey };

describe('verifySnsMessage', () => {
  it('accepts SignatureVersion 1 and 2, with and without a Subject', async () => {
    await expect(verifySnsMessage(signed({}, '2'), options)).resolves.toMatchObject({
      Type: 'Notification',
    });
    await expect(verifySnsMessage(signed({}, '1'), options)).resolves.toBeTruthy();
    await expect(
      verifySnsMessage(signed({ Subject: 'Amazon SES Email Receipt Notification' }), options),
    ).resolves.toBeTruthy();
  });

  it('rejects tampering, a wrong key, an unexpected topic and foreign certificate hosts', async () => {
    const tampered = { ...signed(), Message: '{"notificationType":"Received","evil":true}' };
    await expect(verifySnsMessage(tampered, options)).rejects.toThrow('bad signature');
    await expect(
      verifySnsMessage(signed(), { ...options, loadSigningKey: async () => other }),
    ).rejects.toThrow('bad signature');
    await expect(
      verifySnsMessage(signed({ TopicArn: 'arn:aws:sns:us-east-1:999:evil' }), options),
    ).rejects.toThrow('unexpected topic');
    await expect(
      verifySnsMessage(
        signed({ SigningCertURL: 'https://evil.example.com/sns.amazonaws.com.pem' }),
        options,
      ),
    ).rejects.toBeInstanceOf(SnsVerificationError);
    await expect(verifySnsMessage({ hello: 'world' }, options)).rejects.toThrow(
      'not an SNS message',
    );
  });

  it('checks subscription confirmations, including where the subscribe link points', async () => {
    const confirmation = (url: string) =>
      signed({
        Type: 'SubscriptionConfirmation',
        SubscribeURL: url,
        Token: 'tok',
        Message: 'You have chosen to subscribe',
      });
    await expect(
      verifySnsMessage(
        confirmation('https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=tok'),
        options,
      ),
    ).resolves.toBeTruthy();
    await expect(
      verifySnsMessage(confirmation('https://evil.example.com/confirm'), options),
    ).rejects.toThrow('subscribe URL');
  });
});

describe('isSnsUrl', () => {
  it.each([
    ['https://sns.us-east-1.amazonaws.com/x.pem', true],
    ['https://sns.cn-north-1.amazonaws.com.cn/x.pem', true],
    ['http://sns.us-east-1.amazonaws.com/x.pem', false],
    ['https://sns.us-east-1.amazonaws.com.evil.com/x.pem', false],
    ['https://user@sns.us-east-1.amazonaws.com/x.pem', false],
    ['https://sns.us-east-1.amazonaws.com:8443/x.pem', false],
    ['not a url', false],
  ])('%s → %s', (url, ok) => expect(isSnsUrl(url)).toBe(ok));
});

describe('handleSnsWebhook', () => {
  let db: Db;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
  });
  afterAll(async () => drop());

  it('stores a verified notification once, however often SNS delivers it', async () => {
    const m = signed();
    const deps = { db, ...options };
    expect(await handleSnsWebhook(JSON.stringify(m), deps)).toEqual({ status: 200, body: 'ok' });
    expect(await handleSnsWebhook(JSON.stringify(m), deps)).toEqual({ status: 200, body: 'ok' });
    const rows = await db.select().from(mailEvents).where(eq(mailEvents.snsMessageId, m.MessageId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'Received', status: 'pending', topicArn: TOPIC });
    expect((rows[0]!.payload as typeof receivedNotification).receipt.recipients).toEqual([
      'sales@testtown.com',
    ]);
  });

  it('refuses unverified and malformed bodies without storing them', async () => {
    const before = (await db.select().from(mailEvents)).length;
    const bad = { ...signed(), Signature: Buffer.from('nope').toString('base64') };
    expect((await handleSnsWebhook(JSON.stringify(bad), { db, ...options })).status).toBe(403);
    expect((await handleSnsWebhook('not json', { db, ...options })).status).toBe(400);
    expect(await db.select().from(mailEvents)).toHaveLength(before);
  });

  it('confirms a subscription by visiting the SNS subscribe link', async () => {
    const url = 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=tok';
    const fetchImpl = vi.fn(
      async () => new Response('<ConfirmSubscriptionResponse/>'),
    ) as unknown as typeof fetch;
    const m = signed({
      Type: 'SubscriptionConfirmation',
      SubscribeURL: url,
      Token: 'tok',
      Message: 'confirm',
    });
    expect(await handleSnsWebhook(JSON.stringify(m), { db, ...options, fetchImpl })).toEqual({
      status: 200,
      body: 'ok',
    });
    expect(fetchImpl).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'error' }));
    const [row] = await db
      .select()
      .from(mailEvents)
      .where(eq(mailEvents.snsMessageId, m.MessageId));
    expect(row).toMatchObject({ type: 'SubscriptionConfirmation', status: 'done' });
  });
});
