import { fileURLToPath } from 'node:url';
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
import {
  inspectionSpotlight,
  inspectionSpotlights,
  permitSpotlight,
  permitSpotlights,
} from '../src/spotlights';
import type { TemplatedDraft, TemplateRecord } from '../src/templates';
import { writeCandidate } from '../src/write';

type Town = { name: string; timezone: string; agency: string };
const harbor: Town = {
  name: 'Harbor Point',
  timezone: 'America/New_York',
  agency: 'City of Harbor Point',
};
const pine: Town = {
  name: 'Pine Hollow',
  timezone: 'America/Chicago',
  agency: 'Town of Pine Hollow',
};

const rec = (over: Partial<TemplateRecord> & { id: string }): TemplateRecord => ({
  type: 'x',
  title: null,
  text: null,
  url: null,
  occurredAt: null,
  raw: {},
  ...over,
});

const visit = (
  id: string,
  business: string,
  severity: string,
  total: number,
  hp: number,
  date = '10/13/2026',
  violations: Record<string, number> = { '03': 2, '22': 1 },
) =>
  rec({
    id: `${id}-${date}`,
    type: 'inspection',
    raw: {
      licenseNumber: id,
      business,
      address: `${id} MAIN ST`,
      date,
      visit: 1,
      total,
      highPriority: hp,
      severity,
      violations,
    },
  });

const permit = (id: string, title: string, type: string, cost: number, contractor: string) =>
  rec({
    id,
    type: 'permit',
    title,
    text: `Type: ${type}\nEstimated cost: ${cost}\nContractor: ${contractor}\nStatus: ISSUED`,
    url: `https://data.example.gov/d/${id}`,
  });

describe('choosing spotlights', () => {
  it('picks inspections with enforcement or many violations, most serious first', () => {
    const picks = inspectionSpotlights([
      visit('1', 'QUIET CAFE', 'ok', 2, 0),
      visit('2', 'BUSY GRILL', 'warning', 16, 2),
      visit('3', 'DOCK SUSHI', 'complaint', 9, 4),
      visit('4', 'MAIN DINER', 'warning', 7, 5),
      visit('5', 'SMALL SPOT', 'warning', 4, 1),
    ]);
    expect(picks.map((p) => p.id)).toEqual(['3', '4', '2']);
    expect(picks.every((p) => p.tier === 3)).toBe(true);
  });

  it('picks permits of at least a million dollars, largest first', () => {
    const picks = permitSpotlights([
      permit('p1', 'Tower at 1 MAIN ST', 'Building', 42_000_000, 'BIG BUILD LLC'),
      permit('p2', 'Roof at 9 ELM ST', 'Roofing', 30_000, 'ROOF CO'),
      permit('p3', 'Clinic at 5 OAK AVE', 'Building', 2_500_000, 'CLINIC BUILDERS'),
      permit('p4', 'Shop at 6 OAK AVE', 'Building', 1_200_000, 'SHOP BUILDERS'),
    ]);
    expect(picks.map((p) => p.id)).toEqual(['p1', 'p3']);
  });
});

describe('spotlight stories', () => {
  it('an inspection spotlight quotes the result, the categories and the earlier visits', () => {
    const d = inspectionSpotlight(
      harbor,
      [visit('7', 'DOCK SUSHI', 'complaint', 9, 4)],
      [visit('7', 'DOCK SUSHI', 'ok', 1, 0, '04/02/2026')],
    );
    expect(d.headline).toBe(
      'Inspectors recommend a complaint against Dock Sushi, cited for 9 violations',
    );
    expect(d.bodyMd).toContain('cited 9 violations, four of them high priority');
    expect(d.bodyMd).toContain('administrative complaint');
    expect(d.bodyMd).toContain('Its previous inspection on file, on 04/02/2026, met standards');
    expect(d.bodyMd).toContain('## What was cited');
    expect(d.bodyMd).toContain('foodborne-illness risk factor');
    expect(d.sourceRecordIds).toHaveLength(2);
  });

  it('a permit spotlight gives the cost, type, contractor and share of the week', () => {
    const week = [
      permit('p1', 'Tower at 1 MAIN ST', 'Building', 42_000_000, 'BIG BUILD LLC'),
      permit('p2', 'Roof at 9 ELM ST', 'Roofing', 30_000, 'ROOF CO'),
    ];
    const d = permitSpotlight(harbor, week[0]!, week);
    expect(d.headline).toContain('$42,000,000');
    expect(d.bodyMd).toContain('The contractor of record is Big Build LLC.');
    expect(d.bodyMd).toContain('100% of the estimated cost');
  });
});

// Every spotlight, built for two towns with their own records, stays under the near-duplicate
// limit (docs/plans/google-safety.md), like the roundups in near-duplicate.test.ts.
describe('spotlights and the near-duplicate guard', () => {
  const text = (d: TemplatedDraft) => `${d.dek}\n\n${d.bodyMd}`;
  const check = (label: string, a: TemplatedDraft, b: TemplatedDraft) =>
    it(`${label} reads differently in two towns`, () => {
      const share = nearDuplicateShare(
        { text: text(a), names: [harbor.name, harbor.agency] },
        { text: text(b), names: [pine.name, pine.agency] },
      );
      expect(share, `${label}: ${(share * 100).toFixed(0)}% shared`).toBeLessThanOrEqual(
        NEAR_DUP_MAX,
      );
    });

  check(
    'inspectionSpotlight',
    inspectionSpotlight(
      harbor,
      [visit('7', 'DOCK SUSHI', 'complaint', 9, 4, '10/13/2026', { '03': 2, '08': 1, '22': 3 })],
      [visit('7', 'DOCK SUSHI', 'ok', 1, 0, '04/02/2026')],
    ),
    inspectionSpotlight(
      pine,
      [
        visit('8', 'HOLLOW TAP ROOM', 'closure', 21, 7, '10/14/2026', {
          '01': 1,
          '09': 2,
          '37': 4,
          '41': 1,
        }),
      ],
      [
        visit('8', 'HOLLOW TAP ROOM', 'warning', 6, 2, '06/11/2026'),
        visit('8', 'HOLLOW TAP ROOM', 'ok', 0, 0, '01/20/2026'),
      ],
    ),
  );
  check(
    'permitSpotlight',
    permitSpotlight(
      harbor,
      permit('p1', 'Tower at 1 MAIN ST', 'Building', 42_000_000, 'BIG BUILD LLC'),
      [
        permit('p1', 'Tower at 1 MAIN ST', 'Building', 42_000_000, 'BIG BUILD LLC'),
        permit('p2', 'Roof at 9 ELM ST', 'Roofing', 30_000, 'ROOF CO'),
      ],
    ),
    permitSpotlight(
      pine,
      permit('q1', 'School gym at 40 OAK AVE', 'Commercial', 3_100_000, 'OAK RIDGE BUILDERS'),
      [permit('q1', 'School gym at 40 OAK AVE', 'Commercial', 3_100_000, 'OAK RIDGE BUILDERS')],
    ),
  );
});

// The finder turns a standout record into its own templated item, and the writer builds it
// without a model: an inspection complaint waits for a person (Tier 3, §7).
describe('spotlights in the pipeline', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let townId: string;
  let sourceId: string;
  const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));
  // Tuesday Oct 20 2026, 11 am in Boca: last week is Oct 12–18.
  const NOW = new Date('2026-10-20T15:00:00Z');

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
      .values({
        townId,
        kind: 'inspections',
        platform: 'test',
        adapter: 'test',
        key: 'inspections',
      })
      .returning();
    sourceId = s!.id;
  });
  afterAll(async () => drop());

  it('writes an inspection spotlight for review, with the earlier visit cited', async () => {
    const add = (v: TemplateRecord, day: string) =>
      db.insert(records).values({
        sourceId,
        townId,
        externalId: v.id,
        type: 'inspection',
        title: (v.raw as { business: string }).business,
        text: 'inspection',
        contentHash: v.id,
        occurredAt: new Date(`${day}T00:00:00Z`),
        raw: v.raw,
      });
    await add(visit('9', 'DOCK SUSHI', 'complaint', 9, 4, '10/13/2026'), '2026-10-13');
    await add(visit('9', 'DOCK SUSHI', 'ok', 1, 0, '04/02/2026'), '2026-04-02');
    await add(visit('10', 'QUIET CAFE', 'ok', 0, 0, '10/14/2026'), '2026-10-14');

    const report = await runStoryFinder(db, townId, { now: NOW });
    expect(report.spotlights).toEqual(['spotlight:inspection:2026-10-12:9']);
    const [c] = (await db.select().from(storyCandidates)).filter((r) =>
      r.key.startsWith('spotlight:'),
    );
    expect(c).toMatchObject({ kind: 'template', status: 'accepted', proposedTier: 3 });

    const out = await writeCandidate(db, c!.id, { now: NOW });
    expect(out).toMatchObject({ status: 'in_review', reason: 'tier3' });
    const [a] = (await db.select().from(articles)).filter((r) => r.candidateId === c!.id);
    expect(a!.kind).toBe('story');
    expect(a!.headline).toBe(
      'Inspectors recommend a complaint against Dock Sushi, cited for 9 violations',
    );
    expect(a!.sourceRecordIds).toHaveLength(2);

    // Idempotent: the next run adds no second spotlight.
    const again = await runStoryFinder(db, townId, { now: NOW });
    expect(again.spotlights).toEqual([]);
  });
});
