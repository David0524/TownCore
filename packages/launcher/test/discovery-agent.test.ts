import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Fetcher } from '@towncore/adapters';
import {
  adminActions,
  agentRuns,
  articles,
  eq,
  records,
  sourceProposals,
  sources,
  staff,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import type { LlmProvider, LlmRequest } from '@towncore/pipeline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decideSourceProposal,
  discoveryProgress,
  estimateItemsPerDay,
  exportApprovedSources,
  ProposalRefused,
  runSourceDiscovery,
  withAddedSources,
} from '../src';

// The standing source-discovery agent (docs/plans/agentic-ops.md): towns below the Rule 7 target,
// largest gap first; every suggested URL fetched under Rule 8 and matched in code; proposals with
// an estimate; approval adds the source; `pnpm sources:export` writes it into the YAML.

const NOW = new Date('2026-10-17T12:00:00Z');
const CITY = 'https://city.example.gov';
let db: Db;
let drop: () => Promise<void>;
let shoreId: string;
let otherId: string;

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>City News</title>
<item><title>Council sets budget hearing</title><link>${CITY}/news/1</link><guid>1</guid>
<pubDate>Thu, 15 Oct 2026 14:00:00 GMT</pubDate><description>The budget hearing is Oct. 22.</description></item>
</channel></rss>`;

const web: Record<string, { status: number; body: string; type?: string }> = {
  [`${CITY}/robots.txt`]: { status: 404, body: '' },
  [`${CITY}/news`]: {
    status: 200,
    body: `<html><head><link rel="alternate" type="application/rss+xml" title="City News" href="/news.rss"></head><body>News</body></html>`,
    type: 'text/html',
  },
  [`${CITY}/news.rss`]: { status: 200, body: RSS, type: 'application/rss+xml' },
  [`${CITY}/agendas`]: {
    status: 200,
    body: '<html><body><a href="https://go.boarddocs.com/fl/shore">Meeting agendas</a></body></html>',
    type: 'text/html',
  },
  'https://blocked.example.gov/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /' },
};
const fetched: string[] = [];
const fetcher = new Fetcher({
  minIntervalMs: 0,
  sleep: async () => {},
  fetchImpl: async (url) => {
    fetched.push(String(url));
    const hit = web[String(url)];
    if (!hit) return new Response('not found', { status: 404 });
    return new Response(hit.body, {
      status: hit.status,
      headers: { 'content-type': hit.type ?? 'text/plain' },
    });
  },
});

function fakeModel(): LlmProvider & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    name: 'anthropic',
    webSearch: true,
    calls,
    async generate(request) {
      calls.push(request);
      return {
        text: JSON.stringify({
          sources: [
            { kind: 'city_news', url: `${CITY}/news`, publisher: 'City of Shore', why: 'News' },
            { kind: 'agenda', url: `${CITY}/agendas`, publisher: 'City of Shore', why: 'Agendas' },
            {
              kind: 'police',
              url: 'https://blocked.example.gov/press',
              publisher: 'PD',
              why: 'Releases',
            },
            {
              kind: 'city_news',
              url: 'https://already.example.gov/feed',
              publisher: 'City',
              why: 'Have it',
            },
          ],
          outlets: [],
        }),
        stop: 'end',
        model: request.model,
        usage: { inputTokens: 1000, outputTokens: 300, cacheReadTokens: 0 },
        webSearches: 3,
      };
    },
  };
}

const town = (slug: string, tier: 'small' | 'large') => ({
  slug,
  name: slug,
  state: 'FL',
  county: 'Palm Beach',
  timezone: 'America/New_York',
  domain: `${slug}.test`,
  siteName: `${slug} Daily`,
  status: 'live' as const,
  tier,
  config: { agencies: [`City of ${slug}`], ai_daily_cap_usd: 5, ai_daily_call_cap: 400 },
});

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  const [shore] = await db.insert(towns).values(town('shore', 'large')).returning();
  const [other] = await db.insert(towns).values(town('other', 'small')).returning();
  shoreId = shore!.id;
  otherId = other!.id;
  await db.insert(sources).values({
    townId: shoreId,
    kind: 'city_news',
    platform: 'feed',
    adapter: 'feed',
    url: 'https://already.example.gov/feed',
    key: 'city_news:feed:https://already.example.gov/feed',
  });
  // Another town's feed source has a history: 9 stories in 30 days.
  const [feed] = await db
    .insert(sources)
    .values({
      townId: otherId,
      kind: 'city_news',
      platform: 'feed',
      adapter: 'feed',
      url: 'https://o/f',
      key: 'k',
    })
    .returning();
  for (let i = 0; i < 9; i++) {
    const [rec] = await db
      .insert(records)
      .values({
        sourceId: feed!.id,
        townId: otherId,
        externalId: `r${i}`,
        type: 'news',
        contentHash: `h${i}`,
      })
      .returning();
    await db.insert(articles).values({
      townId: otherId,
      slug: `s${i}`,
      headline: `Story ${i}`,
      bodyMd: 'Body.',
      beat: 'government',
      tier: 1,
      status: 'published',
      byline: 'other Daily Newsroom',
      sourceRecordIds: [rec!.id],
      publishedAt: new Date(NOW.getTime() - (i + 1) * 86_400_000),
    });
  }
});
afterAll(async () => drop());

describe('estimating what a source adds', () => {
  it('uses the network’s own history, never a guess', async () => {
    expect(
      await estimateItemsPerDay(db, { platform: 'feed', kind: 'city_news' }, NOW),
    ).toMatchObject({
      perDay: 0.2,
    });
    const none = await estimateItemsPerDay(db, { platform: 'legistar', kind: 'agenda' }, NOW);
    expect(none.perDay).toBeNull();
  });
});

describe('the discovery agent', () => {
  it('records a skipped run without a web-search model', async () => {
    expect(await runSourceDiscovery({ db, fetcher, now: () => NOW })).toEqual([]);
    const [run] = await db.select().from(agentRuns);
    expect(run).toMatchObject({ agent: 'source-discovery', status: 'skipped' });
  });

  it('proposes verified sources, files adapter requests and skips what Rule 8 forbids', async () => {
    const provider = fakeModel();
    const results = await runSourceDiscovery({
      db,
      fetcher,
      llm: { db, provider, providerName: 'anthropic', now: () => NOW },
      now: () => NOW,
    });
    // Largest gap first: Shore is large (target 10) and has nothing; Other has 0.3 a day of 3.
    expect(results.map((r) => r.siteName)).toEqual(['shore Daily', 'other Daily']);
    expect(results[0]).toMatchObject({ proposed: 1, adapterRequests: 1, refused: 1, suggested: 3 });
    expect(provider.calls[0]!.input).toMatch(/Already have[\s\S]*already\.example\.gov/);
    expect(provider.calls[0]!.webSearch).toBeTruthy();
    // robots.txt said no: the page itself was never fetched.
    expect(fetched).not.toContain('https://blocked.example.gov/press');
    const rows = await db.select().from(sourceProposals).where(eq(sourceProposals.townId, shoreId));
    const feed = rows.find((r) => r.type === 'source')!;
    expect(feed).toMatchObject({
      kind: 'city_news',
      platform: 'feed',
      url: `${CITY}/news.rss`,
      estimatePerDay: 0.2,
      status: 'proposed',
    });
    expect(rows.find((r) => r.type === 'adapter')).toMatchObject({
      kind: 'agenda',
      platform: 'BoardDocs',
      estimatePerDay: null,
    });
    // A second run proposes nothing new.
    const again = await runSourceDiscovery({
      db,
      fetcher,
      llm: { db, provider, providerName: 'anthropic', now: () => NOW },
      now: () => NOW,
    });
    expect(again[0]).toMatchObject({ proposed: 0, adapterRequests: 0 });
  });

  it('adds an approved source to the town and exports it to the YAML', async () => {
    const [me] = await db
      .insert(staff)
      .values({ email: 'ed@towncore.net', name: 'Ed', role: 'reviewer' })
      .returning();
    const [p] = await db.select().from(sourceProposals).where(eq(sourceProposals.type, 'source'));
    const approved = await decideSourceProposal(
      db,
      { id: p!.id, staff: { id: me!.id, role: 'reviewer' }, decision: 'approve' },
      NOW,
    );
    expect(approved.sourceId).toBeTruthy();
    const [src] = await db.select().from(sources).where(eq(sources.id, approved.sourceId!));
    expect(src).toMatchObject({ townId: shoreId, platform: 'feed', url: `${CITY}/news.rss` });
    expect(src!.config).toMatchObject({ timezone: 'America/New_York', format: 'rss' });
    await expect(
      decideSourceProposal(db, {
        id: p!.id,
        staff: { id: me!.id, role: 'reviewer' },
        decision: 'reject',
      }),
    ).rejects.toThrow(ProposalRefused);
    const audit = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'source_proposal.approve'));
    expect(audit).toHaveLength(1);
    expect((await discoveryProgress(db)).get(shoreId)).toMatchObject({ approved: 1, proposed: 1 });

    const dir = mkdtempSync(join(tmpdir(), 'export-'));
    mkdirSync(join(dir, 'fl'));
    const file = join(dir, 'fl', 'shore.yaml');
    writeFileSync(
      file,
      `# Shore Daily
slug: shore
name: shore
state: FL
county: Palm Beach
timezone: America/New_York
site_name: shore Daily
domain: shore.test
tier: large
newsletter_send_time: '06:30'
agencies: [City of shore]
sources:
  # the weather
  - kind: weather
    platform: nws
    zone: FLZ168
pricing: { featured_usd: [19, 12, 7], enhanced_usd: 39 }
`,
    );
    const result = await exportApprovedSources(db, {
      dirs: { towns: dir, launches: dir },
      now: NOW,
    });
    expect(result.written).toHaveLength(1);
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('# the weather');
    expect(text).toMatch(
      /News feed: City News \(found by source discovery, approved 2026-10-17\)\n\s+- kind: city_news/,
    );
    expect(text).toContain('url: https://city.example.gov/news.rss');
    // The rest of the file keeps its own formatting.
    expect(text).toContain('pricing: { featured_usd: [19, 12, 7], enhanced_usd: 39 }');
    expect(text).toContain('agencies: [City of shore]');
    // Exported once.
    expect(
      (await exportApprovedSources(db, { dirs: { towns: dir, launches: dir } })).written,
    ).toEqual([]);
    expect(result.adapterRequests).toEqual([]);
    // Adding the same source twice changes nothing.
    expect(
      withAddedSources(text, [
        {
          source: {
            kind: 'city_news',
            platform: 'feed',
            url: `${CITY}/news.rss`,
            options: { format: 'rss' },
          },
          note: 'x',
        },
      ]),
    ).toBe(text);
  });
});
