import { SendEmailCommand, type SESv2Client } from '@aws-sdk/client-sesv2';
import {
  adminActions,
  contacts,
  emailEvents,
  eq,
  loadRoutingTable,
  mailDomains,
  mailEvents,
  messages,
  signatures,
  staff,
  suppressions,
  syncMailRouting,
  teams,
  threads,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseRawEmail } from '../src/inbound/parse';
import { processReceivedNotification } from '../src/inbound/process';
import {
  fromDisplayName,
  parseRecipientList,
  pickSignature,
  renderSignature,
  replyRecipients,
  replySubject,
} from '../src/outbound/compose';
import { handleSendingEvent } from '../src/outbound/events';
import { buildMime } from '../src/outbound/mime';
import {
  sendNew,
  sendReply,
  SendError,
  SuppressedRecipientsError,
  type SendDeps,
} from '../src/outbound/send';
import { suppress, suppressedAddresses } from '../src/outbound/suppression';
import {
  sesTransport,
  tagValue,
  type MailTransport,
  type SendRequest,
} from '../src/outbound/transport';

describe('compose', () => {
  it('renders signatures and picks the most specific one', () => {
    expect(
      renderSignature('{{user_name}} · {{town_name}} · {{role}}@{{domain}} {{nope}}', {
        user_name: 'Ana',
        town_name: 'Boca Town Square',
        role: 'sales',
        domain: 'boca.test',
      }),
    ).toBe('Ana · Boca Town Square · sales@boca.test {{nope}}');
    const rows = [
      { staffId: null, localPart: null, bodyTemplate: 'default' },
      { staffId: null, localPart: 'sales', bodyTemplate: 'sales role' },
      { staffId: 'ana', localPart: null, bodyTemplate: 'ana' },
      { staffId: 'ana', localPart: 'sales', bodyTemplate: 'ana as sales' },
    ];
    expect(pickSignature(rows, 'ana', 'sales')).toBe('ana as sales');
    expect(pickSignature(rows, 'ana', 'news')).toBe('ana');
    expect(pickSignature(rows, 'ben', 'sales')).toBe('sales role');
    expect(pickSignature(rows, 'ben', 'news')).toBe('default');
    expect(pickSignature([], 'ben', 'news')).toContain('{{user_name}}');
  });

  it('names the sender as the town brand plus the role (brief §7.5)', () => {
    expect(fromDisplayName('Boca Town Square', 'sales')).toBe('Boca Town Square Sales');
    expect(fromDisplayName('Boca Town Square', 'news')).toBe('Boca Town Square Newsroom');
    expect(fromDisplayName('Boca Town Square', null)).toBe('Boca Town Square');
  });

  it('works out reply and reply-all recipients without our own addresses', () => {
    const last = {
      fromAddress: 'Pat@Example.com',
      toAddresses: ['sales@boca.test', 'lee@example.org'],
      ccAddresses: ['pat@example.com', 'news@boca.test', 'kim@example.net'],
    };
    const ourDomains = new Set(['boca.test']);
    expect(replyRecipients(last, { mode: 'reply', ourDomains })).toEqual({
      to: ['pat@example.com'],
      cc: [],
    });
    expect(replyRecipients(last, { mode: 'replyAll', ourDomains })).toEqual({
      to: ['pat@example.com'],
      cc: ['lee@example.org', 'kim@example.net'],
    });
  });

  it('parses recipient lists and reply subjects', () => {
    expect(parseRecipientList('a@x.com, <B@Y.com>; a@x.com nope')).toEqual({
      ok: ['a@x.com', 'b@y.com'],
      bad: ['nope'],
    });
    expect(replySubject('Rates')).toBe('Re: Rates');
    expect(replySubject('RE: Rates')).toBe('RE: Rates');
  });
});

describe('buildMime', () => {
  it('sets From, threading headers, both parts and attachments', async () => {
    const raw = await buildMime({
      from: '"Boca Town Square Sales" <sales@boca.test>',
      to: ['pat@example.com'],
      cc: ['lee@example.org'],
      subject: 'Re: Rates — café',
      text: 'Hello\n\n-- \nAna',
      html: '<p>Hello</p>',
      messageId: 'ours-1@boca.test',
      inReplyTo: 'theirs-1@example.com',
      references: ['root@example.com', 'theirs-1@example.com'],
      attachments: [
        {
          filename: 'rate card.pdf',
          contentType: 'application/pdf',
          content: Buffer.from('%PDF-1.4'),
        },
      ],
    });
    const parsed = await parseRawEmail(raw);
    expect(parsed).toMatchObject({
      from: { address: 'sales@boca.test', name: 'Boca Town Square Sales' },
      to: ['pat@example.com'],
      cc: ['lee@example.org'],
      subject: 'Re: Rates — café',
      rfcMessageId: 'ours-1@boca.test',
      inReplyTo: 'theirs-1@example.com',
      references: ['root@example.com', 'theirs-1@example.com'],
    });
    expect(parsed.text).toContain('Hello');
    expect(parsed.htmlSanitized).toContain('<p>Hello</p>');
    expect(parsed.attachments.map((a) => a.filename)).toEqual(['rate card.pdf']);
    expect(raw.toString()).toContain('X-Auto-Response-Suppress: OOF, AutoReply');
  });
});

describe('sesTransport', () => {
  it('sends raw mail through the configuration set with sanitized tags', async () => {
    const sent: SendEmailCommand[] = [];
    const client = {
      send: async (c: SendEmailCommand) => (sent.push(c), { MessageId: 'ses-1', $metadata: {} }),
    } as unknown as SESv2Client;
    const result = await sesTransport({ region: 'us-east-1', client }).send({
      raw: Buffer.from('raw'),
      from: 'sales@boca.test',
      to: ['pat@example.com'],
      cc: [],
      configurationSet: 'towncore-dev-conversational',
      tags: { domain: 'boca.test', stream: 'conversational' },
    });
    expect(result).toEqual({ sesMessageId: 'ses-1' });
    expect(sent[0]!.input).toMatchObject({
      FromEmailAddress: 'sales@boca.test',
      Destination: { ToAddresses: ['pat@example.com'] },
      ConfigurationSetName: 'towncore-dev-conversational',
      EmailTags: [
        { Name: 'domain', Value: 'boca_test' },
        { Name: 'stream', Value: 'conversational' },
      ],
    });
    expect(tagValue('a.b@c')).toBe('a_b_c');
  });
});

describe('sending (database)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  const ids: Record<string, string> = {};
  const outbox: SendRequest[] = [];
  let failNext = false;
  const transport: MailTransport = {
    name: 'ses',
    async send(request) {
      if (failNext) {
        failNext = false;
        throw new Error('MessageRejected: Email address is not verified.');
      }
      outbox.push(request);
      return { sesMessageId: `0100-ses-${outbox.length}` };
    },
  };
  const stored = new Map<string, Buffer>();
  let deps: SendDeps;
  const ana = () => ({ id: ids.Ana!, name: 'Ana Ruiz' });

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    await syncMailRouting(db);
    for (const t of await db.select().from(teams)) ids[t.name] = t.id;
    const [person] = await db
      .insert(staff)
      .values({ email: 'ana@towncore.net', name: 'Ana Ruiz', role: 'admin' })
      .returning();
    ids.Ana = person!.id;
    const domains = await db
      .insert(mailDomains)
      .values([
        {
          name: 'boca.test',
          displayName: 'Boca Town Square',
          status: 'live',
          inboundEnabled: true,
        },
        { name: 'pending.test', displayName: 'Pending', status: 'onboarding' },
      ])
      .returning();
    for (const d of domains) ids[d.name] = d.id;
    await db.insert(signatures).values({
      staffId: null,
      localPart: 'sales',
      bodyTemplate: '{{user_name}}\n{{town_name}} advertising',
    });
    deps = {
      db,
      transport,
      files: { put: async (key, body) => void stored.set(key, body) },
      region: 'us-east-1',
      configurationSet: 'towncore-dev-conversational',
      now: () => new Date('2026-10-15T15:00:00Z'),
    };
    // An inbound conversation to reply to.
    const raw =
      'From: Pat Reader <pat@example.com>\r\nTo: sales@boca.test\r\nCc: lee@example.org\r\nSubject: Rates\r\nMessage-ID: <in-1@example.com>\r\nDate: Wed, 15 Oct 2026 09:00:00 -0400\r\n\r\nHow much?';
    await processReceivedNotification(
      {
        notificationType: 'Received',
        mail: { messageId: 'ses-in-1', source: 'pat@example.com' },
        receipt: {
          recipients: ['sales@boca.test'],
          action: { type: 'S3', bucketName: 'b', objectKey: 'inbound/ses-in-1' },
        },
      },
      {
        db,
        objects: { getRaw: async () => Buffer.from(raw), putAttachment: async () => {} },
        bucket: 'b',
        routing: await loadRoutingTable(db),
      },
    );
    const [t] = await db.select().from(threads);
    ids.thread = t!.id;
  });
  afterAll(async () => drop());

  const draft = (extra: Partial<Parameters<typeof sendReply>[3]> = {}) => ({
    to: ['pat@example.com'],
    cc: [],
    body: 'A sponsored slot is $199 a month.',
    attachments: [],
    confirmSuppressed: false,
    ...extra,
  });

  it('replies from the exact town address, threaded, signed and tagged', async () => {
    const result = await sendReply(
      deps,
      ana(),
      ids.thread!,
      draft({
        cc: ['lee@example.org'],
        attachments: [
          { filename: 'rates.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF') },
        ],
      }),
    );
    expect(result).toMatchObject({ status: 'sent', error: null });
    const request = outbox.at(-1)!;
    expect(request).toMatchObject({
      from: 'sales@boca.test',
      to: ['pat@example.com'],
      cc: ['lee@example.org'],
      configurationSet: 'towncore-dev-conversational',
      tags: { domain: 'boca.test', stream: 'conversational' },
    });
    const mime = await parseRawEmail(request.raw);
    expect(mime).toMatchObject({
      from: { address: 'sales@boca.test', name: 'Boca Town Square Sales' },
      subject: 'Re: Rates',
      inReplyTo: 'in-1@example.com',
      references: ['in-1@example.com'],
    });
    expect(mime.text).toContain('Ana Ruiz\nBoca Town Square advertising');
    expect(mime.attachments.map((a) => a.filename)).toEqual(['rates.pdf']);

    const [row] = await db.select().from(messages).where(eq(messages.id, result.messageId));
    expect(row).toMatchObject({
      direction: 'outbound',
      deliveryStatus: 'sent',
      sesMessageId: '0100-ses-1',
      rfcMessageId: '0100-ses-1@email.amazonses.com',
      sentByStaffId: ids.Ana,
    });
    expect(row!.altMessageIds).toEqual(
      expect.arrayContaining(['0100-ses-1@us-east-1.amazonses.com', mime.rfcMessageId]),
    );
    expect([...stored.keys()]).toEqual([`attachments/${result.messageId}/0-rates.pdf`]);
    const audit = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.targetId, ids.thread!));
    expect(audit.map((a) => a.action)).toContain('mail_send');
  });

  it('a reply to what SES delivered threads back into the same conversation', async () => {
    const [sent] = await db.select().from(messages).where(eq(messages.sesMessageId, '0100-ses-1'));
    const raw = `From: pat@example.com\r\nTo: sales@boca.test\r\nSubject: Re: Re: Rates\r\nMessage-ID: <in-2@example.com>\r\nIn-Reply-To: <${sent!.rfcMessageId}>\r\n\r\nGreat, thanks.`;
    await processReceivedNotification(
      {
        notificationType: 'Received',
        mail: { messageId: 'ses-in-2', source: 'pat@example.com' },
        receipt: {
          recipients: ['sales@boca.test'],
          action: { type: 'S3', bucketName: 'b', objectKey: 'inbound/ses-in-2' },
        },
      },
      {
        db,
        objects: { getRaw: async () => Buffer.from(raw), putAttachment: async () => {} },
        bucket: 'b',
        routing: await loadRoutingTable(db),
      },
    );
    const [reply] = await db.select().from(messages).where(eq(messages.sesMessageId, 'ses-in-2'));
    expect(reply!.threadId).toBe(ids.thread);
  });

  it('warns about suppressed recipients and sends only when confirmed', async () => {
    await suppress(db, { email: 'gone@example.com', reason: 'hard_bounce' });
    await suppress(db, { email: 'unsub@example.com', reason: 'unsubscribe' });
    await expect(
      sendReply(deps, ana(), ids.thread!, draft({ to: ['gone@example.com'] })),
    ).rejects.toBeInstanceOf(SuppressedRecipientsError);
    // Unsubscribes only stop bulk mail.
    expect(
      await suppressedAddresses(db, ['unsub@example.com'], {
        domainId: ids['boca.test']!,
        stream: 'conversational',
      }),
    ).toEqual([]);
    expect(
      await suppressedAddresses(db, ['unsub@example.com'], {
        domainId: ids['boca.test']!,
        stream: 'bulk',
      }),
    ).toHaveLength(1);
    const sent = await sendReply(
      deps,
      ana(),
      ids.thread!,
      draft({ to: ['gone@example.com'], confirmSuppressed: true }),
    );
    expect(sent.status).toBe('sent');
  });

  it('keeps a failed send on the message with the reason', async () => {
    failNext = true;
    const result = await sendReply(deps, ana(), ids.thread!, draft());
    expect(result).toMatchObject({
      status: 'failed',
      error: 'MessageRejected: Email address is not verified.',
    });
    const [row] = await db.select().from(messages).where(eq(messages.id, result.messageId));
    expect(row).toMatchObject({
      deliveryStatus: 'failed',
      deliveryError: 'MessageRejected: Email address is not verified.',
    });
  });

  it('refuses empty, oversized and not-yet-live sends', async () => {
    await expect(sendReply(deps, ana(), ids.thread!, draft({ body: '  ' }))).rejects.toThrow(
      'Write a message',
    );
    await expect(sendReply(deps, ana(), ids.thread!, draft({ to: [] }))).rejects.toThrow(
      'recipient',
    );
    await expect(
      sendReply(
        deps,
        ana(),
        ids.thread!,
        draft({
          attachments: [
            { filename: 'big', contentType: 'x', content: Buffer.alloc(11 * 1024 * 1024) },
          ],
        }),
      ),
    ).rejects.toThrow('10 MB');
    await expect(
      sendNew(deps, ana(), {
        domainId: ids['pending.test']!,
        localPart: 'sales',
        subject: 'Hi',
        ...draft(),
      }),
    ).rejects.toBeInstanceOf(SendError);
  });

  it('starts a new conversation from a role address, routed to its team', async () => {
    const result = await sendNew(deps, ana(), {
      domainId: ids['boca.test']!,
      localPart: 'sales',
      subject: 'Your listing',
      ...draft({ to: ['owner@shop.example'] }),
    });
    expect(result.status).toBe('sent');
    const [thread] = await db.select().from(threads).where(eq(threads.id, result.threadId));
    expect(thread).toMatchObject({
      townAddress: 'sales@boca.test',
      teamId: ids.Sales,
      assigneeId: ids.Ana,
      subject: 'Your listing',
    });
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, thread!.contactId));
    expect(contact!.email).toBe('owner@shop.example');
    expect((await parseRawEmail(outbox.at(-1)!.raw)).inReplyTo).toBeNull();
  });

  describe('SES sending events', () => {
    async function event(id: string, payload: unknown) {
      const [row] = await db
        .insert(mailEvents)
        .values({ snsMessageId: id, topicArn: 't', type: 'x', payload: payload as object })
        .returning();
      return handleSendingEvent(db, row!.id, payload);
    }
    const mail = (messageId: string) => ({
      messageId,
      timestamp: '2026-10-15T15:00:00Z',
      destination: ['pat@example.com'],
      tags: { 'ses:configuration-set': ['towncore-dev-conversational'] },
    });

    it('tracks delivery, and a later complaint wins over delivered', async () => {
      await event('ev-1', {
        eventType: 'Delivery',
        mail: mail('0100-ses-1'),
        delivery: { recipients: ['pat@example.com', 'lee@example.org'] },
      });
      let [row] = await db.select().from(messages).where(eq(messages.sesMessageId, '0100-ses-1'));
      expect(row!.deliveryStatus).toBe('delivered');
      await event('ev-2', {
        eventType: 'Complaint',
        mail: mail('0100-ses-1'),
        complaint: {
          complainedRecipients: [{ emailAddress: 'pat@example.com' }],
          complaintFeedbackType: 'abuse',
        },
      });
      // A late Send event never moves it back.
      await event('ev-3', { eventType: 'Send', mail: mail('0100-ses-1'), send: {} });
      [row] = await db.select().from(messages).where(eq(messages.sesMessageId, '0100-ses-1'));
      expect(row!.deliveryStatus).toBe('complained');
      const s = await db
        .select()
        .from(suppressions)
        .where(eq(suppressions.email, 'pat@example.com'));
      expect(s.map((x) => [x.reason, x.scope])).toEqual([['complaint', 'global']]);
    });

    it('suppresses hard bounces but not soft ones, and records each recipient once', async () => {
      await event('ev-4', {
        eventType: 'Bounce',
        mail: mail('0100-ses-2'),
        bounce: {
          bounceType: 'Transient',
          bounceSubType: 'MailboxFull',
          bouncedRecipients: [{ emailAddress: 'full@example.com' }],
        },
      });
      const r = await event('ev-5', {
        eventType: 'Bounce',
        mail: mail('0100-ses-2'),
        bounce: {
          bounceType: 'Permanent',
          bounceSubType: 'NoEmail',
          bouncedRecipients: [{ emailAddress: 'Nobody@Example.com' }],
        },
      });
      expect(r).toEqual({ recipients: 1, suppressed: 1 });
      expect(
        await db.select().from(suppressions).where(eq(suppressions.email, 'full@example.com')),
      ).toEqual([]);
      expect(
        (
          await db.select().from(suppressions).where(eq(suppressions.email, 'nobody@example.com'))
        )[0],
      ).toMatchObject({ reason: 'hard_bounce' });
      const [bounced] = await db
        .select()
        .from(messages)
        .where(eq(messages.sesMessageId, '0100-ses-2'));
      expect(bounced).toMatchObject({
        deliveryStatus: 'bounced',
        deliveryError: 'Permanent bounce (NoEmail)',
      });
      const rows = await db
        .select()
        .from(emailEvents)
        .where(eq(emailEvents.sesMessageId, '0100-ses-2'));
      expect(rows.map((x) => [x.type, x.recipient, x.subType])).toEqual(
        expect.arrayContaining([
          ['Bounce', 'full@example.com', 'Transient/MailboxFull'],
          ['Bounce', 'nobody@example.com', 'Permanent/NoEmail'],
        ]),
      );
    });
  });
});
