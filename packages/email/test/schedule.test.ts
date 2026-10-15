import {
  adminActions,
  articles,
  emailCampaigns,
  eq,
  mailDomains,
  newsletterIssues,
  newsletterTesters,
  records,
  sources,
  staff,
  subscribers,
  towns,
  type Db,
  type Town,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import {
  expandDueCampaigns,
  sendDueBatches,
  type MailTransport,
  type SendRequest,
} from '@towncore/mail';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  localMinutes,
  NewsletterError,
  runNewsletterTick,
  sendWindow,
  setNewsletterMode,
} from '../src';

// Boca's send time is 06:30 New York time = 10:30 UTC in October (EDT).
const utc = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, day, h, m));

describe('send window', () => {
  it('uses the town’s local time and gives up 3 hours late', () => {
    expect(localMinutes(utc(15, 10, 31), 'America/New_York')).toBe(6 * 60 + 31);
    expect(sendWindow(utc(15, 10, 0), 'America/New_York', '06:30')).toBe('before');
    expect(sendWindow(utc(15, 10, 35), 'America/New_York', '06:30')).toBe('due');
    expect(sendWindow(utc(15, 13, 45), 'America/New_York', '06:30')).toBe('late');
  });
});

describe('the daily tick', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let town: Town;
  let domainId: string;
  let admin: { id: string };
  let sourceId: string;
  let recordId: string;
  const sent: SendRequest[] = [];
  const transport: MailTransport = {
    name: 'ses',
    async send(r) {
      sent.push(r);
      return { sesMessageId: `ses-${sent.length}` };
    },
  };
  const deps = () => ({
    db,
    transport,
    configurationSet: 'bulk',
    secret: 's'.repeat(40),
    postalAddress: '1 Main St',
    sleep: async () => {},
  });
  let n = 0;
  const story = (beat: string, at: Date) => ({
    townId: town.id,
    slug: `story-${++n}`,
    headline: `Story ${n}`,
    bodyMd: 'Body',
    beat,
    tier: 1,
    status: 'published' as const,
    byline: 'The Tick Times Newsroom (AI-assisted)',
    sourceRecordIds: [recordId],
    publishedAt: at,
  });

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    [town] = (await db
      .insert(towns)
      .values({
        slug: 'tick',
        name: 'Tick',
        state: 'FL',
        county: 'X',
        timezone: 'America/New_York',
        domain: 'tick.test',
        siteName: 'The Tick Times',
        tier: 'small',
        config: { newsletter_send_time: '06:30' },
      })
      .returning()) as [Town];
    const [d] = await db
      .insert(mailDomains)
      .values({
        name: 'tick.test',
        townId: town.id,
        displayName: 'The Tick Times',
        status: 'live',
        bulkStatus: 'warming',
        bulkDailyCap: 50,
        newsletterMode: 'test',
      })
      .returning();
    domainId = d!.id;
    const [ed] = await db
      .insert(staff)
      .values({ email: 'ed@towncore.net', name: 'Ed', role: 'admin' })
      .returning();
    admin = { id: ed!.id };
    await db.insert(newsletterTesters).values({ domainId, staffId: ed!.id });
    const [src] = await db
      .insert(sources)
      .values({ townId: town.id, kind: 'city_news', platform: 'civicplus', adapter: 'civicplus' })
      .returning();
    sourceId = src!.id;
    const [rec] = await db
      .insert(records)
      .values({ sourceId, townId: town.id, externalId: 'r1', type: 'release', contentHash: 'h' })
      .returning();
    recordId = rec!.id;
    await db
      .insert(articles)
      .values([
        story('government', utc(14, 20)),
        story('business', utc(14, 21)),
        story('community', utc(14, 22)),
      ]);
    await db.insert(subscribers).values({
      townId: town.id,
      email: 'reader@example.com',
      status: 'active',
      confirmedAt: utc(1, 0),
    });
  });
  afterAll(async () => drop?.());

  it('waits for the send time, then sends one test issue to the test list only', async () => {
    expect(await runNewsletterTick(deps(), utc(15, 10, 0))).toEqual([
      { town: 'tick', outcome: 'waiting' },
    ]);
    const [first] = await runNewsletterTick(deps(), utc(15, 10, 35));
    expect(first).toMatchObject({ outcome: 'sent_test', detail: '1 tester(s)' });
    expect(sent.map((s) => s.to)).toEqual([['ed@towncore.net']]);
    expect(sent[0]!.tags).toMatchObject({ kind: 'newsletter_test', stream: 'bulk' });
    const [issue] = await db
      .select()
      .from(newsletterIssues)
      .where(eq(newsletterIssues.date, '2026-10-15'));
    expect(issue!.mode).toBe('test');
    expect(issue!.subject).toMatch(/^\[Test\] Thursday: Story \d$/);
    expect(issue!.articleIds).toHaveLength(3);
    // A retried tick never builds or sends a second issue for the same day.
    expect(await runNewsletterTick(deps(), utc(15, 10, 40))).toEqual([
      { town: 'tick', outcome: 'exists' },
    ]);
    expect(sent).toHaveLength(1);
  });

  it('a thin day is skipped and its story waits for the next issue (D-M5-1)', async () => {
    await db.insert(articles).values(story('business', utc(15, 20)));
    const [out] = await runNewsletterTick(deps(), utc(16, 10, 35));
    expect(out).toMatchObject({
      outcome: 'skipped',
      detail: expect.stringMatching(/^1 new story/),
    });
    await db
      .insert(articles)
      .values([story('government', utc(16, 20)), story('community', utc(16, 21))]);
    const [next] = await runNewsletterTick(deps(), utc(17, 10, 35));
    expect(next).toMatchObject({ outcome: 'sent_test' });
    const [issue] = await db
      .select()
      .from(newsletterIssues)
      .where(eq(newsletterIssues.date, '2026-10-17'));
    expect(issue!.articleIds).toHaveLength(3);
  });

  it('going live needs an admin and 3 test issues, and records the approval', async () => {
    await expect(setNewsletterMode(db, admin, domainId, 'live')).rejects.toThrow(
      /at least 3 test issues first \(2 so far\)/,
    );
    await db
      .insert(articles)
      .values([
        story('government', utc(17, 20)),
        story('community', utc(17, 21)),
        story('business', utc(17, 22)),
      ]);
    await runNewsletterTick(deps(), utc(18, 10, 35));
    const [rae] = await db
      .insert(staff)
      .values({ email: 'rae@towncore.net', name: 'Rae', role: 'reviewer' })
      .returning();
    await expect(setNewsletterMode(db, { id: rae!.id }, domainId, 'live')).rejects.toThrow(
      NewsletterError,
    );
    await setNewsletterMode(db, admin, domainId, 'live');
    const [d] = await db.select().from(mailDomains).where(eq(mailDomains.id, domainId));
    expect(d).toMatchObject({ newsletterMode: 'live', newsletterApprovedBy: admin.id });
    const audit = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'newsletter_mode'));
    expect(audit[0]!.detail).toEqual({ from: 'test', to: 'live' });
  });

  it('a live issue goes to every active subscriber through Mail-5, with stats', async () => {
    await db
      .insert(articles)
      .values([
        story('government', utc(18, 20)),
        story('community', utc(18, 21)),
        story('business', utc(18, 22)),
      ]);
    sent.length = 0;
    const [out] = await runNewsletterTick(deps(), utc(19, 10, 35));
    expect(out).toMatchObject({ outcome: 'handed_off' });
    const [campaign] = await db
      .select()
      .from(emailCampaigns)
      .where(eq(emailCampaigns.id, out!.detail!));
    expect(campaign).toMatchObject({
      kind: 'newsletter',
      status: 'scheduled',
      subject: expect.stringMatching(/^Monday: Story 1[1-3]$/),
    });
    await expandDueCampaigns(db, utc(19, 10, 36));
    await sendDueBatches({ ...deps(), now: () => utc(19, 10, 36) });
    expect(sent.map((s) => s.to)).toEqual([['reader@example.com']]);
    await runNewsletterTick(deps(), utc(19, 10, 40));
    const [issue] = await db
      .select()
      .from(newsletterIssues)
      .where(eq(newsletterIssues.date, '2026-10-19'));
    expect(issue).toMatchObject({ mode: 'live', stats: { sent: 1 } });
  });

  it('more than 3 hours late, the day is skipped instead of sent', async () => {
    const [out] = await runNewsletterTick(deps(), utc(20, 14, 0));
    expect(out).toMatchObject({
      outcome: 'skipped',
      detail: 'more than 3 hours past the send time',
    });
  });
});
