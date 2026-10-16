import {
  adminActions,
  articleEntities,
  articles,
  businesses,
  entities,
  eq,
  mailDomains,
  outreachDrafts,
  records,
  sources,
  staff,
  suppressions,
  syncMailRouting,
  threads,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import type { MailTransport, SendRequest } from '@towncore/mail';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dismissOutreach,
  draftOutreach,
  OutreachError,
  pendingOutreach,
  sendOutreach,
} from '../src';

// Outreach drafts (M6 PR F, CLAUDE.md §11): drafted from story mentions, sent only by a person.
const sent: SendRequest[] = [];
const transport: MailTransport = {
  name: 'log',
  async send(request) {
    sent.push(request);
    return { sesMessageId: `m${sent.length}` };
  },
};

describe('outreach drafts', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let townId: string;
  let staffId: string;
  const ids: Record<string, string> = {};
  const now = new Date('2026-10-16T15:00:00Z');
  const deps = () => ({
    db,
    transport,
    region: 'us-east-1',
    configurationSet: 'conv',
    now: () => now,
  });

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    await syncMailRouting(db);
    const [town] = await db
      .insert(towns)
      .values({
        slug: 'reachville',
        name: 'Reachville',
        state: 'FL',
        county: 'X',
        timezone: 'America/New_York',
        domain: 'reachville.test',
        siteName: 'The Reachville Post',
        tier: 'small',
        config: {},
      })
      .returning();
    townId = town!.id;
    const [member] = await db
      .insert(staff)
      .values({ email: 'ed@towncore.net', name: 'Ed', role: 'admin' })
      .returning();
    staffId = member!.id;
    const [source] = await db
      .insert(sources)
      .values({ townId, kind: 'inspections', platform: 'fl-dbpr', adapter: 'fl-dbpr' })
      .returning();
    const record = async (externalId: string) =>
      (
        await db
          .insert(records)
          .values({
            sourceId: source!.id,
            townId,
            externalId,
            type: 'food_license',
            title: externalId,
            occurredAt: now,
            contentHash: externalId,
          })
          .returning()
      )[0]!.id;
    ids.cafeRecord = await record('cafe-license');
    ids.storyRecord = await record('council-agenda');
    const listing = async (slug: string, name: string, extra: object = {}) =>
      (
        await db
          .insert(businesses)
          .values({
            townId,
            slug,
            name,
            category: 'restaurants',
            dataSource: 'fl-dbpr',
            licenseNumber: slug,
            ...extra,
          })
          .returning()
      )[0]!.id;
    ids.cafe = await listing('harbor-cafe', 'Harbor Cafe', { sourceRecordId: ids.cafeRecord });
    ids.bakery = await listing('dock-bakery', 'Dock Bakery LLC', {
      claimedAt: now,
      claimedByEmail: 'owner@dockbakery.test',
    });
    // Two listings share a name: a mention can't say which, so neither gets a draft.
    ids.twinA = await listing('twin-grill', 'Twin Grill');
    ids.twinB = await listing('twin-grill-2', 'Twin Grill');

    const story = async (slug: string, sourceRecordIds: string[], kind = 'story', daysAgo = 1) =>
      (
        await db
          .insert(articles)
          .values({
            townId,
            slug,
            headline: `Headline ${slug}`,
            bodyMd: 'Body.',
            beat: 'business',
            tier: 1,
            status: 'published',
            kind,
            byline: 'The Reachville Post Newsroom (AI-assisted)',
            sourceRecordIds,
            publishedAt: new Date(now.getTime() - daysAgo * 86_400_000),
          })
          .returning()
      )[0]!.id;
    ids.opening = await story('harbor-cafe-opens', [ids.cafeRecord]);
    ids.council = await story('council-hears-plans', [ids.storyRecord]);
    ids.roundup = await story('weekly-filings', [ids.cafeRecord], 'roundup');
    ids.old = await story('old-news', [ids.storyRecord], 'story', 20);
    const entity = async (name: string, key: string) =>
      (
        await db
          .insert(entities)
          .values({ townId, kind: 'business', name, key, slug: key.replace(/ /g, '-') })
          .returning()
      )[0]!.id;
    const bakery = await entity('Dock Bakery', 'dock bakery');
    const twin = await entity('Twin Grill', 'twin grill');
    await db.insert(articleEntities).values([
      { articleId: ids.council!, entityId: bakery, mention: 'Dock Bakery' },
      { articleId: ids.council!, entityId: twin, mention: 'Twin Grill' },
      { articleId: ids.old!, entityId: bakery, mention: 'Dock Bakery' },
    ]);
  });
  afterAll(async () => drop());

  it('drafts one email per mentioned or source listing, never for roundups or twins', async () => {
    expect(
      await draftOutreach(db, townId, { now, postalAddress: '1 Main St, Reachville FL' }),
    ).toEqual({ created: 2 });
    const drafts = await pendingOutreach(db);
    expect(drafts.map((d) => [d.business.name, d.article.slug, d.toEmail]).sort()).toEqual([
      ['Dock Bakery LLC', 'council-hears-plans', 'owner@dockbakery.test'],
      ['Harbor Cafe', 'harbor-cafe-opens', null],
    ]);
    const cafe = drafts.find((d) => d.business.name === 'Harbor Cafe')!;
    expect(cafe.subject).toBe('Harbor Cafe in The Reachville Post');
    expect(cafe.body).toContain('https://reachville.test/news/harbor-cafe-opens');
    expect(cafe.body).toContain('https://reachville.test/directory/restaurants/harbor-cafe');
    expect(cafe.body).toContain('claim the listing for free');
    expect(cafe.body).toContain('reply "no thanks"');
    expect(cafe.body).toContain('1 Main St, Reachville FL');
    const bakery = drafts.find((d) => d.business.name === 'Dock Bakery LLC')!;
    expect(bakery.body).toContain('https://reachville.test/owner');
    expect(sent).toHaveLength(0);
  });

  it('keeps a business quiet for 30 days', async () => {
    expect(await draftOutreach(db, townId, { now })).toEqual({ created: 0 });
  });

  it('sends only when a person presses Send, as an inbox conversation from sales@', async () => {
    const [cafe] = (await pendingOutreach(db)).filter((d) => d.business.name === 'Harbor Cafe');
    const send = (to: string) =>
      sendOutreach(
        deps(),
        { id: staffId, name: 'Ed' },
        {
          draftId: cafe!.id,
          to,
          subject: cafe!.subject,
          body: cafe!.body,
          confirmSuppressed: false,
        },
      );
    await expect(send('')).rejects.toThrow(OutreachError);
    // No live mail domain yet: nothing goes out.
    await expect(send('hello@harborcafe.test')).rejects.toThrow(/isn’t live/);
    await db.insert(mailDomains).values({
      name: 'reachville.test',
      townId,
      displayName: 'The Reachville Post',
      status: 'live',
    });
    const result = await send('hello@harborcafe.test');
    expect(result.status).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(['hello@harborcafe.test']);
    const [thread] = await db.select().from(threads).where(eq(threads.id, result.threadId));
    expect(thread!.townAddress).toBe('sales@reachville.test');
    const [row] = await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, cafe!.id));
    expect(row).toMatchObject({
      status: 'sent',
      toEmail: 'hello@harborcafe.test',
      decidedBy: staffId,
    });
    await expect(send('hello@harborcafe.test')).rejects.toThrow(/already sent/);
  });

  it('never drafts again for a business that asked not to be emailed', async () => {
    await db.insert(suppressions).values({
      email: 'hello@harborcafe.test',
      reason: 'manual',
      scope: 'global',
    });
    // A new story about the cafe, after the quiet period.
    const later = new Date(now.getTime() + 40 * 86_400_000);
    await db.insert(articles).values({
      townId,
      slug: 'harbor-cafe-expands',
      headline: 'Harbor Cafe expands',
      bodyMd: 'Body.',
      beat: 'business',
      tier: 1,
      status: 'published',
      kind: 'story',
      byline: 'The Reachville Post Newsroom (AI-assisted)',
      sourceRecordIds: [ids.cafeRecord!],
      publishedAt: later,
    });
    expect(await draftOutreach(db, townId, { now: later })).toEqual({ created: 0 });
  });

  it('dismissing is audited and leaves nothing to send', async () => {
    const [bakery] = await pendingOutreach(db);
    await dismissOutreach(db, { draftId: bakery!.id, staffId }, now);
    expect(await pendingOutreach(db)).toHaveLength(0);
    const audit = await db.select().from(adminActions);
    expect(audit.map((a) => a.action).sort()).toEqual([
      'directory.outreach.dismiss',
      'directory.outreach.send',
      'mail_send',
    ]);
  });
});
