import { loadEnv } from '@towncore/config';
import {
  adminActions,
  articles,
  eq,
  facebookPosts,
  staff,
  storyCandidates,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  autopostFacebook,
  facebookBatch,
  facebookLink,
  facebookMessage,
  FacebookPostError,
  markFacebookPost,
  postToFacebook,
  queueFacebookPosts,
} from '../src/social';

// Facebook (owner, 2026-10-17; docs/plans/facebook.md): the daily queue, staff marking, and Graph
// API posting only on a press or the owner's standing approval. The live API is never called.

// 11:00 in New York.
const NOW = new Date('2026-10-17T15:00:00Z');
const hours = (n: number) => new Date(NOW.getTime() - n * 3_600_000);
const PAGE = '123456789012345';

let db: Db;
let drop: () => Promise<void>;
let liveId: string;
let draftId: string;
let staffId: string;

const town = (slug: string, status: 'live' | 'draft', facebook?: object) => ({
  slug,
  name: slug,
  state: 'ZZ',
  county: 'Sample',
  timezone: 'America/New_York',
  domain: `${slug}.test`,
  siteName: `${slug} Square`,
  status,
  tier: 'small' as const,
  cohort: '2026-10',
  config: facebook ? { facebook } : {},
});

async function story(
  townId: string,
  slug: string,
  at: Date,
  over: Partial<typeof articles.$inferInsert> = {},
  candidateKey?: string,
) {
  let candidateId: string | undefined;
  if (candidateKey) {
    const [c] = await db
      .insert(storyCandidates)
      .values({
        townId,
        recordIds: [],
        beat: 'business',
        proposedTier: 1,
        key: candidateKey,
        newsworthiness: 50,
      })
      .returning();
    candidateId = c!.id;
  }
  const [a] = await db
    .insert(articles)
    .values({
      townId,
      slug,
      headline: `Headline ${slug}`,
      dek: `Dek for ${slug}.`,
      bodyMd: 'The council voted 5-0 on Tuesday to approve the budget.',
      beat: 'government',
      tier: 2,
      status: 'published',
      byline: 'X Newsroom',
      sourceRecordIds: ['00000000-0000-4000-8000-000000000001'],
      factcheck: { decision: 'pass' },
      publishedAt: at,
      createdAt: at,
      updatedAt: at,
      candidateId,
      ...over,
    })
    .returning();
  return a!;
}

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  const [live] = await db
    .insert(towns)
    .values(town('livetown', 'live', { url: 'https://www.facebook.com/livetown', page_id: PAGE }))
    .returning();
  const [draft] = await db.insert(towns).values(town('drafttown', 'draft')).returning();
  liveId = live!.id;
  draftId = draft!.id;
  const [member] = await db
    .insert(staff)
    .values({ email: 'ed@towncore.net', name: 'Ed', role: 'reviewer' })
    .returning();
  staffId = member!.id;
});
afterAll(async () => drop());

describe('post text', () => {
  it('is the headline and dek, or the first sentence, and links with ?ref=facebook', () => {
    expect(
      facebookMessage({ headline: ' Council passes budget ', dek: 'A 5-0 vote.', bodyMd: '' }),
    ).toBe('Council passes budget\n\nA 5-0 vote.');
    expect(
      facebookMessage({
        headline: 'Council passes budget',
        dek: null,
        bodyMd: '## Vote\n\nThe council voted **5-0** on Tuesday. More follows here today.',
      }),
    ).toBe('Council passes budget\n\nThe council voted 5-0 on Tuesday.');
    expect(facebookLink({ domain: 'a.test' }, { slug: 'x', kind: 'story' })).toBe(
      'https://a.test/news/x?ref=facebook',
    );
  });
});

describe('the daily queue', () => {
  it('queues up to 3 of the day per live town, plus weekly roundups, once each', async () => {
    for (let i = 0; i < 5; i++) await story(liveId, `today-${i}`, hours(i + 1));
    await story(liveId, 'old', hours(30));
    await story(liveId, 'test-article', hours(1));
    await story(liveId, 'pending', hours(1), { status: 'in_review', publishedAt: null });
    await story(liveId, 'places', hours(50), {}, 'roundup:new-places:2026-10-12');
    await story(liveId, 'permits', hours(50), {}, 'roundup:permits:2026-10-12');
    await story(draftId, 'draft-story', hours(1));

    // Before 10:00 town time nothing is picked.
    expect(await queueFacebookPosts(db, new Date('2026-10-17T12:00:00Z'))).toBe(0);
    expect(await queueFacebookPosts(db, NOW)).toBe(4);
    const rows = await db.select().from(facebookPosts);
    const daily = rows.filter((r) => r.kind === 'daily');
    expect(daily).toHaveLength(3);
    expect(rows.every((r) => r.townId === liveId && r.day === '2026-10-17')).toBe(true);
    const weekly = rows.filter((r) => r.kind === 'weekly');
    expect(weekly.map((r) => r.link)).toEqual(['https://livetown.test/news/places?ref=facebook']);
    expect(
      daily.every((r) => /^https:\/\/livetown\.test\/news\/today-\d\?ref=facebook$/.test(r.link)),
    ).toBe(true);

    // The day's three are taken: an hour later nothing more is queued.
    await story(liveId, 'later', hours(0));
    expect(await queueFacebookPosts(db, new Date(NOW.getTime() + 3_600_000))).toBe(0);
  });

  it('groups the batch with each town, and marks posts posted or skipped, audited', async () => {
    const batch = await facebookBatch(db);
    expect(batch).toHaveLength(4);
    expect(batch[0]!.town.facebook?.page_id).toBe(PAGE);
    const [first, second] = batch;
    await markFacebookPost(db, { postId: first!.post.id, staffId, outcome: 'posted', now: NOW });
    await markFacebookPost(db, { postId: second!.post.id, staffId, outcome: 'skipped', now: NOW });
    await expect(
      markFacebookPost(db, { postId: first!.post.id, staffId, outcome: 'posted' }),
    ).rejects.toThrow(FacebookPostError);
    const [marked] = await db
      .select()
      .from(facebookPosts)
      .where(eq(facebookPosts.id, first!.post.id));
    expect(marked).toMatchObject({ status: 'posted', method: 'manual', postedBy: staffId });
    const audit = await db.select().from(adminActions);
    expect(audit.map((a) => a.action).sort()).toEqual(['facebook.mark_posted', 'facebook.skip']);
  });
});

describe('Graph API posting', () => {
  const tokens = { META_PAGE_TOKENS: JSON.stringify({ [PAGE]: 'page-token' }) };

  it('posts only on a press, to /{page-id}/feed with the page token', async () => {
    const [queued] = (await facebookBatch(db)).filter((b) => b.post.status === 'queued');
    const calls: { url: string; body: URLSearchParams }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body as URLSearchParams });
      return Response.json({ id: `${PAGE}_42` });
    }) as unknown as typeof fetch;

    // No standing approval: autopost does nothing, and a post without a person is refused.
    expect(await autopostFacebook(db, { fetchImpl, env: loadEnv(tokens) })).toBe(0);
    await expect(
      postToFacebook(db, {
        postId: queued!.post.id,
        staffId: null,
        fetchImpl,
        env: loadEnv(tokens),
      }),
    ).rejects.toThrow('a person must press Post');
    // No token: refused, nothing sent.
    await expect(
      postToFacebook(db, { postId: queued!.post.id, staffId, fetchImpl, env: loadEnv({}) }),
    ).rejects.toThrow('no Facebook page token');
    expect(calls).toHaveLength(0);

    const posted = await postToFacebook(db, {
      postId: queued!.post.id,
      staffId,
      fetchImpl,
      env: loadEnv(tokens),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://graph.facebook.com/v26.0/${PAGE}/feed`);
    expect(Object.fromEntries(calls[0]!.body)).toEqual({
      message: queued!.post.message,
      link: queued!.post.link,
      access_token: 'page-token',
    });
    expect(posted).toMatchObject({ status: 'posted', method: 'graph', externalId: `${PAGE}_42` });
  });

  it('reports a refusal and leaves the post queued', async () => {
    const [queued] = (await facebookBatch(db)).filter((b) => b.post.status === 'queued');
    const fetchImpl = (async () =>
      Response.json(
        { error: { message: 'Invalid OAuth access token.' } },
        { status: 400 },
      )) as unknown as typeof fetch;
    await expect(
      postToFacebook(db, { postId: queued!.post.id, staffId, fetchImpl, env: loadEnv(tokens) }),
    ).rejects.toThrow('Facebook refused the post: Invalid OAuth access token.');
    const [row] = await db
      .select()
      .from(facebookPosts)
      .where(eq(facebookPosts.id, queued!.post.id));
    expect(row!.status).toBe('queued');

    // Under the owner's standing approval, the worker posts what's left.
    const ok = (async () => Response.json({ id: `${PAGE}_43` })) as unknown as typeof fetch;
    expect(
      await autopostFacebook(db, {
        fetchImpl: ok,
        env: loadEnv({ ...tokens, FACEBOOK_AUTOPOST: 'on' }),
      }),
    ).toBe(1);
  });
});
