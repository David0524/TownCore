import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  arcgisAdapter,
  Fetcher,
  ingestSource,
  replayFetch,
  type FixtureFile,
} from '@towncore/adapters';
import { loadTowns, NEAR_DUP_MAX } from '@towncore/config';
import {
  and,
  articles,
  eq,
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
import { developmentMoves, developmentRoundup, type TemplateRecord } from '../src/templates';
import { writeCandidate } from '../src/write';

// The weekly development projects roundup, from Boca Raton's development map (the arcgis
// adapter's recording of Development/InfrastructureAlerts, 2026-10-17): its first run is the
// baseline, and a second run a week later with projects moved between the stage layers.
const fixturePath = fileURLToPath(
  new URL('../../adapters/fixtures/arcgis/boca-development.json', import.meta.url),
);
const service =
  'https://bocagis.ci.boca-raton.fl.us/gisweb/rest/services/Development/InfrastructureAlerts/MapServer';
const config = {
  stages: { '0': 'proposed', '1': 'approved', '2': 'under_construction', '3': 'completed' },
  caseField: 'CASE_FILE_NUM',
  title: '{PROJECT}',
  fields: {
    PROJECT: 'Project',
    FULLADDR: 'Address',
    DESCRIPTION: 'Description',
    TYPE: 'Use',
    UNITS: 'Size',
    BUILD_HEIGHT: 'Height',
    ZONING: 'Zoning',
    CASE_FILE_NUM: 'Case',
  },
  outFields: [
    'GlobalID',
    'PROJECT',
    'FULLADDR',
    'DESCRIPTION',
    'TYPE',
    'UNITS',
    'BUILD_HEIGHT',
    'ZONING',
    'CASE_FILE_NUM',
  ],
};
const boca = { name: 'Boca Raton', timezone: 'America/New_York', agency: 'City of Boca Raton' };
const pine = { name: 'Pine Hollow', timezone: 'America/Chicago', agency: 'Town of Pine Hollow' };
const week = new Date('2026-10-12T04:00:00Z');

type Feature = { attributes: Record<string, unknown> };
type Body = { features: Feature[] };

/** The recording with features moved between stage layers, removed or added. */
function editedFixture(edit: (layers: Body[]) => void): FixtureFile {
  const file = JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureFile;
  const queries = file.exchanges.filter((e) => e.url.includes('/query?'));
  const layers = queries.map((e) => JSON.parse(e.body!) as Body);
  edit(layers);
  queries.forEach((e, i) => (e.body = JSON.stringify(layers[i])));
  return file;
}

/** Takes the feature named `project` out of whichever layer has it. */
function take(layers: Body[], project: string): Feature {
  for (const layer of layers) {
    const i = layer.features.findIndex((f) => f.attributes.PROJECT === project);
    if (i >= 0) return layer.features.splice(i, 1)[0]!;
  }
  throw new Error(`no ${project} in the recording`);
}

const project = (
  id: string,
  name: string,
  stage: string,
  at: string | null,
  over: { size?: string; what?: string; address?: string; case?: string } = {},
): TemplateRecord => ({
  id: `${id}:${stage}`,
  type: 'development-project',
  title: name,
  text: [
    `Stage: ${stage}`,
    `Project: ${name}`,
    `Address: ${over.address ?? `${id} Main Street`}`,
    over.what ? `Description: ${over.what}` : null,
    over.size ? `Size: ${over.size}` : null,
  ]
    .filter(Boolean)
    .join('\n'),
  url: 'https://gis.example.gov/server/rest/services/Planning/Projects/MapServer/0',
  occurredAt: at ? new Date(at) : null,
  raw: { project: `{${id}}`, case: over.case ?? null, stage },
});

describe('development moves', () => {
  it('finds new and moved projects, largest first, and leaves out repeats and single homes', () => {
    const moves = developmentMoves([
      project('1', 'Harbor Lofts', 'proposed', null, { size: '42 Units' }),
      project('1', 'Harbor Lofts', 'approved', '2026-10-14T12:00:00Z', { size: '42 Units' }),
      project('2', 'Mill Street Hotel', 'proposed', '2026-10-14T12:00:00Z', { size: '120 Rooms' }),
      // Re-keyed by the city but at the same stage: not news.
      project('3', 'Depot Square', 'under_construction', null, { case: 'SP-26-01' }),
      project('4', 'Depot Square', 'under_construction', '2026-10-14T12:00:00Z', {
        case: 'SP-26-01',
      }),
      project('5', 'Lot 7 Shore Road', 'completed', '2026-10-14T12:00:00Z', {
        size: '1 Units',
        what: 'Variance to build a 2-story single-family home.',
      }),
    ]);
    expect(moves.map((m) => [m.name, m.before, m.stage])).toEqual([
      ['Mill Street Hotel', null, 'proposed'],
      ['Harbor Lofts', 'proposed', 'approved'],
    ]);
  });

  it('reads differently in two towns', async () => {
    const records = await arcgisAdapter.fetch(
      { id: 's', townId: 't', kind: 'permits', platform: 'arcgis', url: service, config },
      null,
      {
        fetcher: new Fetcher({
          fetchImpl: replayFetch(fixturePath),
          sleep: async () => {},
          now: () => 0,
          minIntervalMs: 0,
        }),
        now: new Date('2026-10-17T12:00:00Z'),
      },
    );
    // Boca's first six approved projects, each first seen this week, moved from proposed.
    const bocaRecs = records
      .filter((r) => (r.raw as { stage: string }).stage === 'approved')
      .slice(0, 6)
      .flatMap((r, i): TemplateRecord[] => {
        const now = {
          id: `b${i}`,
          type: r.type,
          title: r.title ?? null,
          text: r.text ?? null,
          url: r.url ?? null,
          occurredAt: new Date('2026-10-14T12:00:00Z'),
          raw: r.raw,
        };
        const was = { ...now, id: `b${i}-was`, occurredAt: null };
        return [now, { ...was, raw: { ...(r.raw as object), stage: 'proposed' } }];
      });
    const a = developmentRoundup(boca, week, bocaRecs, [3, 1]);
    expect(a.headline).toMatch(/moves from proposed to approved on Boca Raton's development map/);
    const b = developmentRoundup(pine, week, [
      project('p1', 'Ridge Commons', 'proposed', null, { size: '64 Units' }),
      project('p1', 'Ridge Commons', 'under_construction', '2026-10-13T12:00:00Z', {
        size: '64 Units',
        what: 'Three-story apartment buildings with a clubhouse and a pond trail.',
      }),
      project('p2', 'Hollow Creek Clinic', 'approved', '2026-10-15T12:00:00Z', {
        what: 'A one-story medical office of 12,000 square feet on County Road 9.',
      }),
    ]);
    expect(b.headline).toBe(
      "Ridge Commons (64 units) moves from proposed to under construction on Pine Hollow's development map, one of 2 changes",
    );
    const share = nearDuplicateShare(
      { text: `${a.dek}\n\n${a.bodyMd}`, names: [boca.name, boca.agency] },
      { text: `${b.dek}\n\n${b.bodyMd}`, names: [pine.name, pine.agency] },
    );
    expect(share).toBeLessThanOrEqual(NEAR_DUP_MAX);
  });
});

describe('development projects in the pipeline', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let townId: string;
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
  });
  afterAll(async () => drop());

  it('takes the first run as the baseline, then rounds up what moved, Tier 2', async () => {
    const [row] = await db
      .insert(sources)
      .values({
        townId,
        kind: 'permits',
        platform: 'arcgis',
        adapter: 'arcgis',
        key: 'permits:arcgis:development',
        url: service,
        config,
      })
      .returning();
    const reload = async () => (await db.select().from(sources).where(eq(sources.id, row!.id)))[0]!;
    const run = async (fixture: FixtureFile | string, at: string) =>
      ingestSource(
        db,
        await reload(),
        arcgisAdapter,
        new Fetcher({
          fetchImpl: replayFetch(fixture),
          sleep: async () => {},
          now: () => 0,
          minIntervalMs: 0,
        }),
        new Date(at),
      );

    expect(await run(fixturePath, '2026-10-05T12:00:00Z')).toMatchObject({ newItems: 143 });
    // A week later: Mizner Plaza is approved, a single home is completed, and a new
    // townhouse project is proposed.
    const moved = editedFixture((layers) => {
      layers[1]!.features.push(take(layers, 'Mizner Plaza'));
      layers[3]!.features.push(take(layers, 'Redlhammer Subdiv Lot 21A & Lot 22A'));
      layers[0]!.features.push({
        attributes: {
          GlobalID: '{00000000-0000-4000-8000-000000000001}',
          PROJECT: 'Spanish River Townhomes',
          FULLADDR: '900 West Spanish River Boulevard',
          DESCRIPTION: 'Request to construct 18 two-story townhomes.',
          UNITS: '18',
          CASE_FILE_NUM: 'PZSPA-2026-00042',
        },
      });
    });
    expect(await run(moved, '2026-10-14T12:00:00Z')).toMatchObject({ newItems: 3 });

    const report = await runStoryFinder(db, townId, { now: NOW });
    expect(report.roundups).toContain('roundup:development:2026-10-12');
    const [c] = await db
      .select()
      .from(storyCandidates)
      .where(
        and(
          eq(storyCandidates.townId, townId),
          eq(storyCandidates.key, 'roundup:development:2026-10-12'),
        ),
      );
    expect(c).toMatchObject({ kind: 'roundup', proposedTier: 2, beat: 'development' });

    const out = await writeCandidate(db, c!.id, { now: NOW, random: () => 0.99 });
    expect(out).toMatchObject({ status: 'published' });
    const [a] = (await db.select().from(articles)).filter((r) => r.candidateId === c!.id);
    expect(a!.tier).toBe(2);
    expect(a!.headline).toBe(
      "Mizner Plaza (242 rooms) moves from proposed to approved on Boca Raton's development map, one of 2 changes",
    );
    expect(a!.bodyMd).toContain('Spanish River Townhomes');
    expect(a!.bodyMd).toContain('New to the map');
    expect(a!.bodyMd).not.toMatch(/Redlhammer/);
    // Cites Mizner Plaza's earlier, proposed record for where it was.
    const cited = await db.select().from(records).where(eq(records.townId, townId));
    const mizner = cited.filter((r) => r.title === 'Mizner Plaza').map((r) => r.id);
    expect(mizner).toHaveLength(2);
    expect(a!.sourceRecordIds).toEqual(expect.arrayContaining(mizner));
  });
});
