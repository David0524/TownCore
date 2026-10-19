import {
  adminActions,
  and,
  contacts,
  eq,
  mailDomains,
  messages,
  records,
  sources,
  staff,
  teams,
  threads,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  NewsroomError,
  newsroomRecords,
  releaseText,
  releaseTitle,
  sendToNewsroom,
  suggestKind,
} from '../src/press-releases';

// Press releases from the newsroom inbox: "Send to newsroom" stores an inbound release as a
// primary-source record of the town (Rule 3: only from the organization itself).

const RELEASE = [
  'FOR IMMEDIATE RELEASE',
  '',
  'The City of Sample Town will close Ocean Avenue between 1st and 3rd streets from 7 a.m. to',
  '5 p.m. on Oct. 22 for water main repairs, the Public Works Department said.',
  '',
  '',
  '',
  '> On Monday someone wrote:',
  '> an older quoted message',
].join('\n');

describe('release text', () => {
  it('drops quoted replies, control characters and extra blank lines', () => {
    const text = releaseText({ textBody: `${RELEASE}\u0007`, htmlBodySanitized: null });
    expect(text).toContain('FOR IMMEDIATE RELEASE\n\nThe City of Sample Town');
    expect(text).not.toContain('older quoted');
    expect(text).not.toContain('\u0007');
    expect(text).not.toMatch(/\n{3}/);
  });

  it('reads the sanitized HTML when there is no text part', () => {
    expect(
      releaseText({
        textBody: null,
        htmlBodySanitized: '<p>Road <b>closed</b>.</p><p>Second paragraph.</p>',
      }),
    ).toBe('Road closed.\nSecond paragraph.');
  });

  it('cleans the subject', () => {
    expect(releaseTitle('Fwd: RE: Ocean Avenue closure')).toBe('Ocean Avenue closure');
    expect(releaseTitle('Ocean Avenue closure')).toBe('Ocean Avenue closure');
  });

  it('suggests the kind from the sender’s domain and the town’s sources', () => {
    const townSources = [
      { kind: 'city_news', url: 'https://www.sampletown.gov/news' },
      { kind: 'police', url: 'https://police.sampletown.gov/releases' },
      { kind: 'weather', url: null },
    ];
    // The city's own domain is the government, even with a police subdomain beside it.
    expect(suggestKind('pio@sampletown.gov', townSources)).toBe('city_news');
    expect(suggestKind('news@www.sampletown.gov', townSources)).toBe('city_news');
    expect(suggestKind('pio@police.sampletown.gov', townSources)).toBe('police');
    expect(suggestKind('chief@mail.police.sampletown.gov', townSources)).toBe('police');
    expect(suggestKind('clerk@sampletown.gov', [townSources[0]!])).toBe('city_news');
    expect(suggestKind('desk@othernews.com', townSources)).toBeNull();
    expect(suggestKind('not-an-address', townSources)).toBeNull();
  });
});

describe('sendToNewsroom', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let townId: string;
  let staffId: string;
  let threadId: string;
  let noTownThreadId: string;
  const NOW = new Date('2026-10-19T12:00:00Z');

  const message = async (thread: string, over: Partial<typeof messages.$inferInsert> = {}) => {
    const [m] = await db
      .insert(messages)
      .values({
        threadId: thread,
        direction: 'inbound',
        rfcMessageId: `<${Math.random().toString(36).slice(2)}@sampletown.gov>`,
        fromAddress: 'pio@sampletown.gov',
        fromName: 'Public Information Office',
        subject: 'Fwd: Ocean Avenue closure',
        textBody: RELEASE,
        sentAt: new Date('2026-10-19T09:00:00Z'),
        ...over,
      })
      .returning();
    return m!;
  };

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    const [town] = await db
      .insert(towns)
      .values({
        slug: 'sample',
        name: 'Sample Town',
        state: 'ZZ',
        county: 'Sample',
        timezone: 'America/New_York',
        domain: 'sampletownsquare.test',
        siteName: 'Sample Town Square',
        status: 'live',
        tier: 'small',
        config: {},
      })
      .returning();
    townId = town!.id;
    const [s] = await db
      .insert(staff)
      .values({ email: 'ed@towncore.net', name: 'Ed', role: 'reviewer' })
      .returning();
    staffId = s!.id;
    const [team] = await db.insert(teams).values({ name: 'Editorial' }).returning();
    const [contact] = await db
      .insert(contacts)
      .values({ email: 'pio@sampletown.gov', name: 'PIO' })
      .returning();
    const [domain, internal] = await db
      .insert(mailDomains)
      .values([
        { name: 'sampletownsquare.test', townId, displayName: 'Sample Town Square' },
        { name: 'towncore.test', displayName: 'TownCore' },
      ])
      .returning();
    const thread = async (domainId: string, address: string) =>
      (
        await db
          .insert(threads)
          .values({
            domainId,
            teamId: team!.id,
            contactId: contact!.id,
            subject: 'Ocean Avenue closure',
            normalizedSubject: 'ocean avenue closure',
            townAddress: address,
            lastMessageAt: NOW,
          })
          .returning()
      )[0]!.id;
    threadId = await thread(domain!.id, 'news@sampletownsquare.test');
    noTownThreadId = await thread(internal!.id, 'info@towncore.test');
  });
  afterAll(async () => drop());

  it('stores the release as a primary-source record of the town, once, and audits it', async () => {
    const m = await message(threadId);
    const first = await sendToNewsroom(db, {
      messageId: m.id,
      staffId,
      kind: 'city_news',
      fromOrganization: true,
      now: NOW,
    });
    expect(first).toMatchObject({ created: true, townId });
    const [record] = await db.select().from(records).where(eq(records.id, first.recordId));
    expect(record).toMatchObject({
      townId,
      type: 'release',
      title: 'Ocean Avenue closure',
      url: null,
      externalId: `message:${m.rfcMessageId}`,
      occurredAt: m.sentAt,
    });
    expect(record!.text).toContain('water main repairs');
    expect(record!.text).not.toContain('older quoted');
    expect(record!.raw).toMatchObject({
      messageId: m.rfcMessageId,
      inboxMessageId: m.id,
      threadId,
      from: 'pio@sampletown.gov',
      fromOrganizationConfirmed: true,
    });
    // The town's inbox source for that kind, made on first use.
    const [source] = await db.select().from(sources).where(eq(sources.id, record!.sourceId));
    expect(source).toMatchObject({
      townId,
      kind: 'city_news',
      platform: 'inbox',
      adapter: 'inbox',
      key: 'inbox:city_news',
    });
    const audit = await db
      .select()
      .from(adminActions)
      .where(and(eq(adminActions.action, 'newsroom.send'), eq(adminActions.targetId, m.id)));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.detail).toMatchObject({ recordId: first.recordId, kind: 'city_news' });

    // Sent again, even under another kind: the same record, no second audit entry.
    const again = await sendToNewsroom(db, {
      messageId: m.id,
      staffId,
      kind: 'police',
      fromOrganization: true,
    });
    expect(again).toEqual({ recordId: first.recordId, created: false, townId });
    expect(await db.select().from(sources).where(eq(sources.key, 'inbox:police'))).toHaveLength(0);
    const status = await newsroomRecords(db, [m]);
    expect(status.get(m.id)).toEqual({ recordId: first.recordId, kind: 'city_news' });

    // A second release reuses the town's source.
    const m2 = await message(threadId, { subject: 'Ocean Avenue reopens' });
    const second = await sendToNewsroom(db, {
      messageId: m2.id,
      staffId,
      kind: 'city_news',
      fromOrganization: true,
    });
    const [r2] = await db.select().from(records).where(eq(records.id, second.recordId));
    expect(r2!.sourceId).toBe(record!.sourceId);
  });

  it('refuses without the Rule 3 confirmation, an unknown kind, or an unusable message', async () => {
    const m = await message(threadId);
    const send = (over: Partial<Parameters<typeof sendToNewsroom>[1]>) =>
      sendToNewsroom(db, {
        messageId: m.id,
        staffId,
        kind: 'police',
        fromOrganization: true,
        ...over,
      });
    await expect(send({ fromOrganization: false })).rejects.toThrow(/Rule 3/);
    // Another outlet's story can't be filed under any kind.
    await expect(send({ kind: 'other_outlet' })).rejects.toThrow(NewsroomError);
    await expect(send({ kind: 'weather' })).rejects.toThrow(NewsroomError);
    const ours = await message(threadId, { direction: 'outbound' });
    await expect(send({ messageId: ours.id })).rejects.toThrow(/received/);
    const virus = await message(threadId, { quarantined: true });
    await expect(send({ messageId: virus.id })).rejects.toThrow(/quarantined/);
    const thin = await message(threadId, { textBody: 'See attached.' });
    await expect(send({ messageId: thin.id })).rejects.toThrow(/too little text/);
    const internal = await message(noTownThreadId);
    await expect(send({ messageId: internal.id })).rejects.toThrow(/isn’t a town’s/);
    expect(
      await db
        .select()
        .from(records)
        .where(eq(records.externalId, `message:${m.rfcMessageId}`)),
    ).toHaveLength(0);
  });

  it('keys a message without a Message-ID by its own id', async () => {
    const m = await message(threadId, { rfcMessageId: null });
    const sent = await sendToNewsroom(db, {
      messageId: m.id,
      staffId,
      kind: 'fire',
      fromOrganization: true,
    });
    const [record] = await db.select().from(records).where(eq(records.id, sent.recordId));
    expect(record!.externalId).toBe(`message:${m.id}`);
  });
});
