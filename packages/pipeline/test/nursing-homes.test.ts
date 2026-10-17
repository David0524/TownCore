import { fileURLToPath } from 'node:url';
import { cmsAdapter, Fetcher, replayFetch, type RawRecord } from '@towncore/adapters';
import { loadTowns, NEAR_DUP_MAX } from '@towncore/config';
import {
  articles,
  getTownBySlug,
  records,
  sources,
  storyCandidates,
  syncTowns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runStoryFinder } from '../src/finder';
import { nearDuplicateShare } from '../src/near-duplicate';
import { nursingHomeSpotlight, nursingHomeSpotlights } from '../src/spotlights';
import { nursingHomesRoundup, type TemplatedDraft, type TemplateRecord } from '../src/templates';
import { decideTier } from '../src/tiers';
import { writeCandidate } from '../src/write';

// The nursing-home roundup and spotlights (CMS Care Compare, every town), built from the
// adapter's own recordings of Boca Raton and West Palm Beach (September 2026 release, read
// 2026-10-17), and a fictional second town for the near-duplicate guard.
const fixture = (name: string) =>
  fileURLToPath(new URL(`../../adapters/fixtures/cms/${name}.json`, import.meta.url));
const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));
type Town = { name: string; timezone: string; agency: string };
const boca: Town = {
  name: 'Boca Raton',
  timezone: 'America/New_York',
  agency: 'City of Boca Raton',
};
const wpb: Town = {
  name: 'West Palm Beach',
  timezone: 'America/New_York',
  agency: 'City of West Palm Beach',
};
const pine: Town = {
  name: 'Pine Hollow',
  timezone: 'America/Chicago',
  agency: 'Town of Pine Hollow',
};
const week = new Date('2026-10-12T04:00:00Z');
const NOW = new Date('2026-10-17T12:00:00Z');

async function cmsRecords(name: string, city: string): Promise<RawRecord[]> {
  const fetcher = new Fetcher({
    fetchImpl: replayFetch(fixture(name)),
    sleep: async () => {},
    now: () => 0,
    minIntervalMs: 0,
  });
  return cmsAdapter.fetch(
    {
      id: 's',
      townId: 't',
      kind: 'health_facilities',
      platform: 'cms',
      url: null,
      config: { city, state: 'FL' },
    },
    null,
    { fetcher, now: NOW },
  );
}

const asTemplate = (raw: RawRecord[]): TemplateRecord[] =>
  raw.map((r, i) => ({
    id: `r${i}`,
    type: r.type,
    title: r.title ?? null,
    text: r.text ?? null,
    url: r.url ?? null,
    occurredAt: r.occurredAt ?? null,
    raw: r.raw,
  }));

const citation = (tag: string, category: string, severity: string, description: string) => ({
  tag,
  category,
  description,
  severity,
  complaint: false,
  infectionControl: false,
});

/** A fictional town's inspections, in the adapter's raw shape. */
const pineHomes: TemplateRecord[] = [
  {
    id: 'p1',
    type: 'nursing-home-inspection',
    title: 'HOLLOW CREEK CARE CENTER',
    text: 'Facility: HOLLOW CREEK CARE CENTER',
    url: 'https://www.medicare.gov/care-compare/details/nursing-home/265001?state=MO',
    occurredAt: new Date('2026-08-19T00:00:00Z'),
    raw: {
      ccn: '265001',
      name: 'HOLLOW CREEK CARE CENTER',
      address: '40 RIDGE ROAD',
      zip: '65000',
      beds: 60,
      date: '2026-08-19',
      kinds: ['standard'],
      citations: [
        citation(
          'F0880',
          'Infection Control Deficiencies',
          'F',
          'Provide and implement an infection prevention and control program.',
        ),
        citation(
          'F0761',
          'Pharmacy Service Deficiencies',
          'E',
          'Ensure drugs and biologicals used in the facility are labeled in accordance with currently accepted professional principles; and all drugs and biologicals must be stored in locked compartments, separately locked, compartments for controlled drugs.',
        ),
        citation(
          'F0584',
          'Environmental Deficiencies',
          'D',
          'Honor the resident’s right to a safe, clean, comfortable and homelike environment, including but not limited to receiving treatment and supports for daily living safely.',
        ),
      ],
      worst: 'F',
      previous: { date: '2025-06-30', citations: 9 },
      homesInTown: 2,
    },
  },
  {
    id: 'p2',
    type: 'nursing-home-inspection',
    title: 'PINE HOLLOW MANOR',
    text: 'Facility: PINE HOLLOW MANOR',
    url: 'https://www.medicare.gov/care-compare/details/nursing-home/265002?state=MO',
    occurredAt: new Date('2026-07-02T00:00:00Z'),
    raw: {
      ccn: '265002',
      name: 'PINE HOLLOW MANOR',
      address: '1200 MILL STREET',
      zip: '65001',
      beds: 98,
      date: '2026-07-02',
      kinds: ['complaint'],
      citations: [
        citation(
          'F0689',
          'Quality of Life and Care Deficiencies',
          'G',
          'Ensure that a nursing home area is free from accident hazards and provides adequate supervision to prevent accidents.',
        ),
      ],
      worst: 'G',
      previous: null,
      homesInTown: 2,
    },
  },
  {
    id: 'p3',
    type: 'nursing-home-penalty',
    title: 'PINE HOLLOW MANOR',
    text: 'Facility: PINE HOLLOW MANOR',
    url: 'https://www.medicare.gov/care-compare/details/nursing-home/265002?state=MO',
    occurredAt: new Date('2026-08-11T00:00:00Z'),
    raw: {
      ccn: '265002',
      name: 'PINE HOLLOW MANOR',
      address: '1200 MILL STREET',
      zip: '65001',
      beds: 98,
      date: '2026-08-11',
      type: 'fine',
      amount: 41_250,
      denialDays: null,
      homesInTown: 2,
    },
  },
];

const share = (a: TemplatedDraft, ta: Town, b: TemplatedDraft, tb: Town) =>
  nearDuplicateShare(
    { text: `${a.dek}\n\n${a.bodyMd}`, names: [ta.name, ta.agency] },
    { text: `${b.dek}\n\n${b.bodyMd}`, names: [tb.name, tb.agency] },
  );

describe('nursing homes roundup', () => {
  it('leads with the most serious finding and lists every inspection', async () => {
    const recs = asTemplate(await cmsRecords('boca-raton', 'Boca Raton'));
    const d = nursingHomesRoundup(boca, week, recs);
    // Boca's worst in the window is a pattern-level E at one home; nothing rated harm.
    expect(d.headline).toMatch(
      /^.+ gets \d+ citations? in a federal inspection, one of \d+ nursing homes with a Boca Raton address in the latest federal data$/,
    );
    expect(d.dek).toMatch(
      /^\d+ citations from federal health inspections of \d+ nursing homes with a Boca Raton address, between .+ and .+\.$/,
    );
    expect(d.bodyMd).toMatch(
      /^Federal health inspectors who visited .+ on .+ issued \d+ citations?\./,
    );
    expect(d.bodyMd).toContain('rated no actual harm (E) on the federal scale');
    expect(d.bodyMd).toContain('none rated as actual harm to a resident');
    expect(d.bodyMd).toContain('CMS lists 11 nursing homes with a Boca Raton address.');
    expect(d.bodyMd).toContain('## What stands out');
    expect(d.bodyMd).toContain('https://www.medicare.gov/care-compare/details/nursing-home/');
    expect(d.sourceRecordIds).toHaveLength(recs.length);
    expect(d.beat).toBe('business');
  });

  it('puts immediate jeopardy and fines first', async () => {
    const recs = asTemplate(await cmsRecords('west-palm-beach', 'West Palm Beach'));
    const d = nursingHomesRoundup(wpb, week, recs);
    expect(d.headline).toBe(
      'Federal inspectors cite immediate jeopardy at Aviata at West Palm Beach, one of 2 nursing homes with a West Palm Beach address in the latest federal data',
    );
    expect(d.bodyMd).toContain('rated immediate jeopardy (J) on the federal scale');
    expect(d.bodyMd).toContain(
      'Federal regulators imposed a $13,065 fine on Aviata at West Palm Beach on March 13.',
    );
    expect(d.dek).toContain('$13,065 in fines');
  });

  it('reads differently in two towns', async () => {
    const a = nursingHomesRoundup(
      boca,
      week,
      asTemplate(await cmsRecords('boca-raton', 'Boca Raton')),
    );
    const b = nursingHomesRoundup(pine, week, pineHomes);
    expect(b.headline).toBe(
      'Federal inspectors cite actual harm at Pine Hollow Manor, one of 2 nursing homes with a Pine Hollow address in the latest federal data',
    );
    expect(share(a, boca, b, pine)).toBeLessThanOrEqual(NEAR_DUP_MAX);
  });

  it('always goes to a person (§7)', () => {
    const t = decideTier({
      sourceKinds: ['health_facilities'],
      beat: 'business',
      classification: null,
      text: '',
      baseTier: 1,
    });
    expect(t.tier).toBe(3);
    expect(t.reasons).toContain('health inspection findings at a named facility');
  });
});

describe('nursing home spotlights', () => {
  it('picks homes with harm, immediate jeopardy, a payment denial or a large fine', async () => {
    const wpbRecs = asTemplate(await cmsRecords('west-palm-beach', 'West Palm Beach'));
    expect(nursingHomeSpotlights(wpbRecs).map((s) => [s.id, s.tier])).toEqual([['105558', 3]]);
    expect(nursingHomeSpotlights(asTemplate(await cmsRecords('boca-raton', 'Boca Raton')))).toEqual(
      [],
    );
    expect(nursingHomeSpotlights(pineHomes).map((s) => [s.id, s.recordIds])).toEqual([
      ['265002', ['p2', 'p3']],
    ]);
  });

  it('a spotlight gives every citation, the penalty and the previous inspection', async () => {
    const wpbRecs = asTemplate(await cmsRecords('west-palm-beach', 'West Palm Beach'));
    const [spot] = nursingHomeSpotlights(wpbRecs);
    const d = nursingHomeSpotlight(
      wpb,
      week,
      wpbRecs.filter((r) => spot!.recordIds.includes(r.id)),
    );
    expect(d.headline).toBe(
      'Federal inspectors cite immediate jeopardy at Aviata at West Palm Beach; regulators fine it $13,065',
    );
    expect(d.bodyMd).toMatch(
      /^Federal health inspectors visited Aviata at West Palm Beach, a 120-bed nursing home at 5065 Wallis Road, on March 13 and issued 2 citations\./,
    );
    expect(d.bodyMd).toContain('## What inspectors cited');
    expect(d.bodyMd).toContain(
      'Federal regulators imposed a $13,065 fine on Aviata at West Palm Beach',
    );

    const p = nursingHomeSpotlight(
      pine,
      week,
      pineHomes.filter((r) => r.id !== 'p1'),
    );
    expect(share(d, wpb, p, pine)).toBeLessThanOrEqual(NEAR_DUP_MAX);
  });
});

describe('nursing homes in the pipeline', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let townId: string;
  let sourceId: string;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    const loaded = loadTowns(townsDir).filter((t) => t.config.slug === 'boca-raton');
    await syncTowns(
      db,
      loaded.map((t) => ({ ...t, config: { ...t.config, sources: [] } })),
    );
    townId = (await getTownBySlug(db, 'boca-raton'))!.id;
    const [s] = await db
      .insert(sources)
      .values({ townId, kind: 'health_facilities', platform: 'cms', adapter: 'cms', key: 'cms' })
      .returning();
    sourceId = s!.id;
  });
  afterAll(async () => drop());

  it('rounds up what was first read last week, for review, with a spotlight', async () => {
    // Read by last week's run (Monday, Oct. 12), though the visits were months earlier.
    const read = new Date('2026-10-13T15:00:00Z');
    for (const r of pineHomes) {
      await db.insert(records).values({
        sourceId,
        townId,
        externalId: r.id,
        type: r.type,
        title: r.title,
        text: r.text,
        url: r.url,
        contentHash: r.id,
        occurredAt: r.occurredAt,
        raw: r.raw,
        createdAt: read,
      });
    }
    // The finder rounds up last week from Tuesday on.
    const tuesday = new Date('2026-10-20T15:00:00Z');
    const report = await runStoryFinder(db, townId, { now: tuesday });
    expect(report.roundups).toContain('roundup:nursing-homes:2026-10-12');
    expect(report.spotlights).toEqual(['spotlight:nursing-home:2026-10-12:265002']);
    const candidates = await db.select().from(storyCandidates);
    const roundup = candidates.find((c) => c.key === 'roundup:nursing-homes:2026-10-12')!;
    expect(roundup).toMatchObject({ kind: 'roundup', proposedTier: 3 });
    expect(roundup.recordIds).toHaveLength(3);

    for (const c of candidates.filter((x) => x.key.includes('nursing-home'))) {
      const out = await writeCandidate(db, c.id, { now: tuesday });
      expect(out).toMatchObject({ status: 'in_review', reason: 'tier3' });
    }
    const written = (await db.select().from(articles)).map((a) => [a.kind, a.headline]);
    expect(written).toEqual(
      expect.arrayContaining([
        [
          'roundup',
          'Federal inspectors cite actual harm at Pine Hollow Manor, one of 2 nursing homes with a Boca Raton address in the latest federal data',
        ],
        [
          'story',
          'Federal inspectors cite actual harm at Pine Hollow Manor; regulators fine it $41,250',
        ],
      ]),
    );

    // Idempotent: the next run adds nothing.
    const again = await runStoryFinder(db, townId, { now: tuesday });
    expect(again.roundups).not.toContain('roundup:nursing-homes:2026-10-12');
    expect(again.spotlights).toEqual([]);
  });
});
