import { readFileSync } from 'node:fs';
import {
  attachments,
  eq,
  loadRoutingTable,
  mailDomains,
  mailEvents,
  messages,
  sql,
  syncMailRouting,
  teams,
  threads,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_EVENT_ATTEMPTS, processDueEvents } from '../src/inbound/events';
import {
  processReceivedNotification,
  safeFilename,
  type MailObjectStore,
  type ProcessDeps,
} from '../src/inbound/process';

const eml = (name: string) => readFileSync(new URL(`../fixtures/eml/${name}.eml`, import.meta.url));

let db: Db;
let drop: () => Promise<void>;
let deps: ProcessDeps;
let objects: ReturnType<typeof fakeObjects>;
let teamName: Map<string, string>;

function fakeObjects() {
  const raw = new Map<string, Buffer>();
  const puts = new Map<string, { body: Buffer; contentType: string }>();
  const store: MailObjectStore = {
    async getRaw(_bucket, key) {
      const body = raw.get(key);
      if (!body) throw new Error(`NoSuchKey ${key}`);
      return body;
    },
    async putAttachment(key, body, contentType) {
      puts.set(key, { body, contentType });
    },
  };
  return { store, raw, puts };
}

let seq = 0;
function received(
  fixture: string,
  recipients: string[],
  verdicts: { spam?: string; virus?: string } = {},
) {
  const id = `ses-${++seq}`;
  objects.raw.set(`inbound/${id}`, eml(fixture));
  return {
    notificationType: 'Received',
    mail: { messageId: id, source: 'bounce@example.com', timestamp: '2026-10-15T12:00:00Z' },
    receipt: {
      recipients,
      spamVerdict: { status: verdicts.spam ?? 'PASS' },
      virusVerdict: { status: verdicts.virus ?? 'PASS' },
      spfVerdict: { status: 'PASS' },
      dkimVerdict: { status: 'PASS' },
      dmarcVerdict: { status: 'PASS' },
      action: {
        type: 'S3',
        bucketName: 'mail-bucket',
        objectKey: `inbound/${id}`,
        topicArn: 'arn:x',
      },
    },
  };
}

async function threadOf(sesId: string, recipient: string) {
  const [row] = await db
    .select({ thread: threads, message: messages })
    .from(messages)
    .innerJoin(threads, eq(messages.threadId, threads.id))
    .where(
      sql`${messages.sesMessageId} = ${sesId} and ${messages.envelopeRecipient} = ${recipient}`,
    );
  return row!;
}

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  await syncMailRouting(db);
  await db.insert(mailDomains).values([
    {
      name: 'testtown.com',
      displayName: 'Test Town Times',
      isTest: true,
      status: 'live',
      inboundEnabled: true,
    },
    {
      name: 'notyet.com',
      displayName: 'Not Yet',
      isTest: true,
      status: 'onboarding',
      inboundEnabled: false,
    },
  ]);
  teamName = new Map((await db.select().from(teams)).map((t) => [t.id, t.name]));
  objects = fakeObjects();
  deps = {
    db,
    objects: objects.store,
    bucket: 'mail-bucket',
    routing: await loadRoutingTable(db),
    now: () => new Date('2026-10-15T12:00:00Z'),
  };
});
afterAll(async () => drop());

describe('processReceivedNotification', () => {
  it('routes sales@, admin@ and random@ to the right team queues', async () => {
    const n = received('multipart-alternative', [
      'sales@testtown.com',
      'admin@testtown.com',
      'random@testtown.com',
    ]);
    const result = await processReceivedNotification(n, deps);
    expect(result).toMatchObject({ outcome: 'stored', stored: 3, duplicates: 0, dropped: [] });
    const id = n.mail.messageId;
    const sales = await threadOf(id, 'sales@testtown.com');
    expect(teamName.get(sales.thread.teamId)).toBe('Sales');
    expect(sales.thread).toMatchObject({
      townAddress: 'sales@testtown.com',
      status: 'open',
      subject: 'Advertising question',
    });
    expect(teamName.get((await threadOf(id, 'admin@testtown.com')).thread.teamId)).toBe('Admin');
    // Catch-all.
    expect(teamName.get((await threadOf(id, 'random@testtown.com')).thread.teamId)).toBe('Admin');
    expect(sales.message).toMatchObject({
      direction: 'inbound',
      fromAddress: 'pat.reader@example.com',
      fromName: 'Pat Reader',
      rfcMessageId: 'abc123@mail.example.com',
      spamVerdict: 'PASS',
      rawS3Key: `inbound/${id}`,
    });
    expect(sales.message.htmlBodySanitized).not.toContain('<script');
  });

  it('a duplicate SNS delivery creates nothing new', async () => {
    const n = received('odd-encodings', ['tips@testtown.com']);
    expect((await processReceivedNotification(n, deps)).stored).toBe(1);
    const again = await processReceivedNotification(n, deps);
    expect(again).toMatchObject({ stored: 0, duplicates: 1 });
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.sesMessageId, n.mail.messageId));
    expect(rows).toHaveLength(1);
  });

  it('threads a reply by its headers, and reopens a closed conversation', async () => {
    const first = received('multipart-alternative', ['sales@testtown.com']);
    await processReceivedNotification(first, deps);
    const original = await threadOf(first.mail.messageId, 'sales@testtown.com');
    // Pretend our outbound reply (Mail-4) went out with this Message-ID, then close the thread.
    await db.insert(messages).values({
      threadId: original.thread.id,
      direction: 'outbound',
      rfcMessageId: 'out-1@testtown.com',
      fromAddress: 'sales@testtown.com',
      subject: 'Re: Advertising question',
      sentAt: new Date('2026-10-14T15:00:00Z'),
    });
    await db.update(threads).set({ status: 'closed' }).where(eq(threads.id, original.thread.id));

    const reply = received('reply', ['sales@testtown.com']);
    await processReceivedNotification(reply, deps);
    const answered = await threadOf(reply.mail.messageId, 'sales@testtown.com');
    expect(answered.thread.id).toBe(original.thread.id);
    expect(answered.thread.status).toBe('open');
  });

  it('falls back to contact + address + subject when headers are missing', async () => {
    const first = received('missing-headers', ['random@testtown.com']);
    await processReceivedNotification(first, deps);
    const a = await threadOf(first.mail.messageId, 'random@testtown.com');
    expect(a.thread.subject).toBe('(no subject)');
    // No subject: never joined by the fallback, so a second one is its own thread.
    const second = received('missing-headers', ['random@testtown.com']);
    await processReceivedNotification(second, deps);
    expect((await threadOf(second.mail.messageId, 'random@testtown.com')).thread.id).not.toBe(
      a.thread.id,
    );

    // Same contact, address and subject without reply headers: joins.
    const third = received('odd-encodings', ['tips@testtown.com']);
    await processReceivedNotification(third, deps);
    const fourth = received('odd-encodings', ['tips@testtown.com']);
    await processReceivedNotification(fourth, deps);
    expect((await threadOf(fourth.mail.messageId, 'tips@testtown.com')).thread.id).toBe(
      (await threadOf(third.mail.messageId, 'tips@testtown.com')).thread.id,
    );
  });

  it('stores attachments and inline images in S3 with their content ids', async () => {
    const n = received('inline-and-attachment', ['news@testtown.com']);
    await processReceivedNotification(n, deps);
    const { message, thread } = await threadOf(n.mail.messageId, 'news@testtown.com');
    expect(teamName.get(thread.teamId)).toBe('Editorial');
    const rows = await db.select().from(attachments).where(eq(attachments.messageId, message.id));
    expect(rows.map((a) => [a.filename, a.contentType, a.inline, a.contentId, a.s3Key])).toEqual([
      ['flood.png', 'image/png', true, 'img1@example.org', `attachments/${message.id}/0-flood.png`],
      ['permit.pdf', 'application/pdf', false, null, `attachments/${message.id}/1-permit.pdf`],
    ]);
    expect(objects.puts.get(`attachments/${message.id}/1-permit.pdf`)?.body.toString()).toContain(
      '%PDF',
    );
  });

  it('quarantines a virus: the message is kept, attachments are never extracted', async () => {
    const before = objects.puts.size;
    const n = received('inline-and-attachment', ['news@testtown.com'], { virus: 'FAIL' });
    await processReceivedNotification(n, deps);
    const { message } = await threadOf(n.mail.messageId, 'news@testtown.com');
    expect(message).toMatchObject({ quarantined: true, virusVerdict: 'FAIL' });
    const rows = await db.select().from(attachments).where(eq(attachments.messageId, message.id));
    expect(rows.map((a) => a.s3Key)).toEqual([null, null]);
    expect(objects.puts.size).toBe(before);
  });

  it('puts new spam conversations in spam, and flags auto-replies', async () => {
    const spam = received('odd-encodings', ['advertise@testtown.com'], { spam: 'FAIL' });
    await processReceivedNotification(spam, deps);
    expect((await threadOf(spam.mail.messageId, 'advertise@testtown.com')).thread.status).toBe(
      'spam',
    );

    const ooo = received('auto-reply', ['sales@testtown.com']);
    await processReceivedNotification(ooo, deps);
    expect((await threadOf(ooo.mail.messageId, 'sales@testtown.com')).message.isAutomated).toBe(
      true,
    );
  });

  it('drops recipients on domains that are not live, without fetching the message', async () => {
    const n = received('multipart-alternative', ['sales@notyet.com', 'sales@elsewhere.com']);
    objects.raw.delete(n.receipt.action.objectKey);
    expect(await processReceivedNotification(n, deps)).toEqual({
      outcome: 'dropped',
      stored: 0,
      duplicates: 0,
      dropped: [
        { recipient: 'sales@notyet.com', reason: 'unknown_domain' },
        { recipient: 'sales@elsewhere.com', reason: 'unknown_domain' },
      ],
    });
  });

  it('refuses a notification that names another bucket', async () => {
    const n = received('reply', ['sales@testtown.com']);
    n.receipt.action.bucketName = 'someone-elses-bucket';
    await expect(processReceivedNotification(n, deps)).rejects.toThrow('expected mail-bucket');
  });
});

describe('processDueEvents', () => {
  it('processes pending events once, retries failures with backoff, then gives up', async () => {
    await db.insert(mailEvents).values([
      { snsMessageId: 'e-ok', topicArn: 't', type: 'Received', payload: { ok: true } },
      { snsMessageId: 'e-bad', topicArn: 't', type: 'Received', payload: { ok: false } },
    ]);
    const handler = async (e: { payload: unknown }) => {
      if ((e.payload as { ok: boolean }).ok) return { status: 'done' as const };
      throw new Error('S3 timeout');
    };
    expect(await processDueEvents(db, handler)).toEqual({
      done: 1,
      dropped: 0,
      retried: 1,
      failed: 0,
    });
    // Nothing is due until the backoff passes.
    expect(await processDueEvents(db, handler)).toEqual({
      done: 0,
      dropped: 0,
      retried: 0,
      failed: 0,
    });

    const [bad] = await db.select().from(mailEvents).where(eq(mailEvents.snsMessageId, 'e-bad'));
    expect(bad).toMatchObject({ status: 'pending', attempts: 1, lastError: 'S3 timeout' });
    for (let i = 1; i < MAX_EVENT_ATTEMPTS; i++) {
      await db
        .update(mailEvents)
        .set({ nextAttemptAt: new Date(0) })
        .where(eq(mailEvents.snsMessageId, 'e-bad'));
      await processDueEvents(db, handler);
    }
    const [given] = await db.select().from(mailEvents).where(eq(mailEvents.snsMessageId, 'e-bad'));
    expect(given).toMatchObject({ status: 'failed', attempts: MAX_EVENT_ATTEMPTS });
    const [ok] = await db.select().from(mailEvents).where(eq(mailEvents.snsMessageId, 'e-ok'));
    expect(ok).toMatchObject({ status: 'done', attempts: 1 });
  });
});

describe('safeFilename', () => {
  it.each([
    ['permit.pdf', 'permit.pdf'],
    ['../../etc/passwd', 'etc_passwd'],
    ['Café menu (2).pdf', 'Cafe_menu_2_.pdf'],
    ['', 'attachment'],
  ])('%j → %j', (input, expected) => expect(safeFilename(input)).toBe(expected));
});
