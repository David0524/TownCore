import { readFileSync } from 'node:fs';
import { contrastRatio, defaultTheme, parseTheme } from '@towncore/config';
import {
  articles,
  campaigns,
  corrections,
  records,
  sources,
  towns,
  type Db,
  type Town,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  gatherIssue,
  issueSubject,
  issueWeather,
  renderIssue,
  selectIssueItems,
  shouldSend,
  storyUrl,
  type IssueContent,
} from '../src';

const at = (h: number) => new Date(Date.UTC(2026, 9, 15, h));
const item = (id: string, beat: string, hour: number) => ({ id, beat, publishedAt: at(hour) });

describe('selecting stories', () => {
  it('keeps rank order, only new stories, at most 8, one public-safety item', () => {
    const ranked = [
      item('a', 'public-safety', 10),
      item('b', 'public-safety', 10),
      item('old', 'government', 1),
      ...['c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((id) => item(id, 'business', 10)),
      item('gov', 'government', 10),
    ];
    const picked = selectIssueItems(ranked, at(5)).map((i) => i.id);
    expect(picked).toHaveLength(8);
    expect(picked.filter((id) => id === 'a' || id === 'b')).toEqual(['a']);
    expect(picked).not.toContain('old');
    // A civic story exists, so it replaces the lowest-ranked other pick.
    expect(picked.at(-1)).toBe('gov');
  });

  it('sends with 3 stories or a weather alert, skips otherwise (D-M5-1)', () => {
    expect(shouldSend(3, 0)).toEqual({ send: true });
    expect(shouldSend(0, 1)).toEqual({ send: true });
    expect(shouldSend(2, 0)).toEqual({
      send: false,
      reason: expect.stringMatching(/^2 new stories/),
    });
  });
});

describe('weather', () => {
  it('takes two forecast periods and only alerts that have not expired', () => {
    const w = issueWeather(
      {
        url: 'https://forecast.weather.gov/x',
        raw: {
          periods: [
            { name: 'Today', detailedForecast: 'Sunny, high near 84.' },
            { name: 'Tonight', detailedForecast: 'Clear, low around 70.' },
            { name: 'Thursday', detailedForecast: 'Sunny.' },
          ],
        },
      },
      [
        {
          title: 'Rip Current Statement',
          url: 'https://alerts/1',
          raw: { ends: at(20).toISOString() },
        },
        { title: 'Old warning', url: 'https://alerts/2', raw: { expires: at(1).toISOString() } },
      ],
      at(12),
    );
    expect(w?.periods.map((p) => p.name)).toEqual(['Today', 'Tonight']);
    expect(w?.alerts).toEqual([{ headline: 'Rip Current Statement', url: 'https://alerts/1' }]);
    expect(issueWeather(null, [], at(12))).toBeNull();
  });
});

const content = (over: Partial<IssueContent> = {}): IssueContent => ({
  town: {
    id: 't',
    slug: 'boca-raton',
    name: 'Boca Raton',
    siteName: 'Boca Town Square',
    domain: 'bocatownsquare.com',
    timezone: 'America/New_York',
  },
  palette: defaultTheme.palette,
  date: '2026-10-15',
  since: at(0),
  items: [
    {
      id: '1',
      slug: 'council-budget',
      headline: 'Council adopts $1.2 billion budget',
      dek: 'The vote was 4-1.',
      beat: 'government',
    },
    {
      id: '2',
      slug: 'new-cafe',
      headline: 'Café <Mizner> opens on Palmetto Park Road',
      dek: null,
      beat: 'business',
    },
    {
      id: '3',
      slug: 'permits',
      headline: 'Permits filed this week',
      dek: 'Twelve permits.',
      beat: 'development',
    },
  ],
  weather: {
    periods: [{ name: 'Today', text: 'Sunny.' }],
    alerts: [],
    url: 'https://forecast.weather.gov/x',
  },
  meetings: [{ title: 'City Council', url: 'https://myboca.us/cal/1', startsAt: at(22) }],
  corrections: [{ headline: 'Earlier story', slug: 'earlier', note: 'The vote was 4-1, not 5-0.' }],
  top: null,
  mid: {
    paid: false,
    label: 'From Boca Town Square',
    headline: 'Advertise in Boca Town Square',
    href: 'mailto:news@bocatownsquare.com',
    cta: 'Get in touch',
  },
  ...over,
});

describe('rendering', () => {
  it('a plain subject and preheader', () => {
    const r = renderIssue(content());
    expect(r.subject).toBe('Thursday: Council adopts $1.2 billion budget');
    expect(r.preheader).toBe('Café <Mizner> opens on Palmetto Park Road · Permits filed this week');
    expect(
      issueSubject(
        content({
          weather: { periods: [], alerts: [{ headline: 'Hurricane Warning', url: 'u' }], url: 'u' },
        }),
      ),
    ).toBe('Thursday: Hurricane Warning');
  });

  it('links stories with ?ref=newsletter, escapes text, names the newsroom and carries no images', () => {
    const r = renderIssue(content());
    expect(r.html).toContain(`href="${storyUrl('bocatownsquare.com', 'council-budget')}"`);
    expect(storyUrl('bocatownsquare.com', 'council-budget')).toBe(
      'https://bocatownsquare.com/news/council-budget?ref=newsletter',
    );
    expect(r.html).toContain('Café &lt;Mizner&gt; opens');
    expect(r.html).not.toMatch(/<img|<script/i);
    expect(r.html).toContain('Boca Town Square Newsroom');
    expect(r.html).toContain('Thursday, October 15, 2026');
    expect(r.html).toContain('Coming up');
    expect(r.html).toContain('Thu, Oct 15, 6:00 PM: <a href="https://myboca.us/cal/1"');
    expect(r.html).toContain('The vote was 4-1, not 5-0.');
    for (const part of [
      'TOP STORIES',
      'https://bocatownsquare.com/news/new-cafe?ref=newsletter',
      'COMING UP',
      'CORRECTIONS',
      'Newsroom from public records',
    ])
      expect(r.text).toContain(part);
  });

  it('labels paid units "Sponsored" (Rule 6)', () => {
    const r = renderIssue(
      content({
        top: {
          paid: true,
          label: 'Sponsored · Acme Roofing',
          headline: 'Roof check',
          href: 'https://acme.example',
        },
      }),
    );
    expect(r.html).toContain('Sponsored · Acme Roofing');
    expect(r.text).toContain('[Sponsored · Acme Roofing] Roof check');
  });

  it('the email colors pass AA on white and on the card surface for every theme', () => {
    const themes = [
      defaultTheme,
      parseTheme(
        readFileSync(new URL('../../../towns/fl/boca-raton.theme.json', import.meta.url), 'utf8'),
      ),
      parseTheme(
        readFileSync(
          new URL(
            '../../../apps/web/e2e/fixtures/towns/me/harbor-point.theme.json',
            import.meta.url,
          ),
          'utf8',
        ),
      ),
    ];
    for (const { palette } of themes) {
      expect(contrastRatio(palette.ink, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.ink, palette.surface)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('gathering an issue from the database', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let town: Town;
  const now = at(11); // 7:00 in Boca

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    [town] = (await db
      .insert(towns)
      .values({
        slug: 'gather',
        name: 'Gather',
        state: 'FL',
        county: 'X',
        timezone: 'America/New_York',
        domain: 'gather.test',
        siteName: 'The Gather Post',
        tier: 'small',
        config: {},
      })
      .returning()) as [Town];
    const [src] = await db
      .insert(sources)
      .values({ townId: town.id, kind: 'weather', platform: 'nws', adapter: 'nws' })
      .returning();
    const rec = (type: string, title: string, occurredAt: Date, raw: unknown = {}) => ({
      sourceId: src!.id,
      townId: town.id,
      externalId: `${type}:${title}`,
      type,
      title,
      url: `https://example.gov/${type}`,
      occurredAt,
      raw,
      contentHash: title,
    });
    const recs = await db
      .insert(records)
      .values([
        rec('forecast', 'Zone forecast', at(9), {
          periods: [{ name: 'Today', detailedForecast: 'Sunny, high near 84.' }],
        }),
        rec('meeting', 'City Commission', at(23)),
        rec('meeting', 'Last week meeting', at(1)),
      ])
      .returning();
    const story = (slug: string, beat: string, hour: number) => ({
      townId: town.id,
      slug,
      headline: `Headline ${slug}`,
      dek: `Dek ${slug}`,
      bodyMd: 'Body',
      beat,
      tier: 1,
      status: 'published' as const,
      byline: 'The Gather Post Newsroom',
      sourceRecordIds: [recs[0]!.id],
      publishedAt: at(hour),
    });
    const rows = await db
      .insert(articles)
      .values([
        story('fresh-1', 'business', 8),
        story('fresh-2', 'government', 9),
        story('fresh-3', 'community', 10),
        story('yesterday', 'business', -20),
      ])
      .returning();
    await db.insert(corrections).values({ articleId: rows[1]!.id, note: 'Fixed a date.' });
    await db.insert(campaigns).values({
      townId: town.id,
      slot: 'newsletter.top',
      creative: {
        headline: 'Roof check',
        href: 'https://acme.example',
        advertiser: 'Acme Roofing',
      },
      startsAt: at(0),
      status: 'active',
    });
  });
  afterAll(async () => drop?.());

  it('collects new stories, weather, meetings, corrections and one paid unit', async () => {
    const c = await gatherIssue(db, town, now);
    expect(c.date).toBe('2026-10-15');
    expect(c.items.map((i) => i.slug).sort()).toEqual(['fresh-1', 'fresh-2', 'fresh-3']);
    expect(c.weather?.periods).toEqual([{ name: 'Today', text: 'Sunny, high near 84.' }]);
    expect(c.meetings.map((m) => m.title)).toEqual(['City Commission']);
    expect(c.corrections).toEqual([
      { headline: 'Headline fresh-2', slug: 'fresh-2', note: 'Fixed a date.' },
    ]);
    expect(c.top).toMatchObject({ paid: true, label: 'Sponsored · Acme Roofing' });
    // D-M5-4: with the top slot sold, the mid slot is a house ad.
    expect(c.mid.paid).toBe(false);
    expect(c.mid.label).toBe('From The Gather Post');
  });
});
