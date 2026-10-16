import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adminActions, eq, staff, townCandidates, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  milesBetween,
  parseGazetteerPlaces,
  percentiles,
  rankingCsv,
  rankingReport,
  rankPlaces,
  CandidateDecisionError,
  decideCandidate,
  listCandidates,
  readAcsPlaces,
  readPopEstimates,
  readZctaPlaces,
  readZipBusiness,
  saveCandidates,
  type RankFacts,
} from '../src';

// towns:rank (M7 PR A, CLAUDE.md §10a). The samples below are short hand-written excerpts in each
// Census file's published layout (header row and delimiter as published); the figures are
// illustrative except the Gazetteer rows, which are the real Boca Raton and Delray Beach lines.

const dir = mkdtempSync(join(tmpdir(), 'rank-'));
const file = (name: string, text: string) => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};

const GAZETTEER = `USPS|GEOID|GEOIDFQ|ANSICODE|NAME|LSAD|FUNCSTAT|ALAND|AWATER|ALAND_SQMI|AWATER_SQMI|INTPTLAT|INTPTLONG
FL|1207300|1600000US1207300|02403887|Boca Raton city|25|A|75570156|6237074|29.178|2.408|26.370809|-80.102558
FL|1217100|1600000US1217100|02404212|Delray Beach city|25|A|41290548|1535920|15.942|0.593|26.455903|-80.09042
FL|1299991|1600000US1299991|00000000|Sample Lakes CDP|57|S|1000|0|1.0|0|26.5|-80.2
`;

describe('Census file readers', () => {
  it('keeps incorporated places and drops the "city" suffix', () => {
    const places = parseGazetteerPlaces(`\uFEFF${GAZETTEER}`);
    expect(places.map((p) => [p.geoid, p.name])).toEqual([
      ['1207300', 'Boca Raton'],
      ['1217100', 'Delray Beach'],
    ]);
    expect(places[1]).toMatchObject({ lat: 26.455903, lon: -80.09042, landSqMi: 15.942 });
  });

  it('reads place population estimates (SUMLEV 162 only)', async () => {
    const path = file(
      'pop.csv',
      `SUMLEV,STATE,COUNTY,PLACE,COUSUB,CONCIT,PRIMGEO_FLAG,FUNCSTAT,NAME,STNAME,ESTIMATESBASE2020,POPESTIMATE2020,POPESTIMATE2021,POPESTIMATE2022,POPESTIMATE2023,POPESTIMATE2024,POPESTIMATE2025
040,12,000,00000,00000,00000,0,A,Florida,Florida,21538187,21589602,21828069,22245521,22610726,23002597,23300000
162,12,000,07300,00000,00000,0,A,Boca Raton city,Florida,97422,97500,98000,98600,99000,99500,100100
157,12,099,07300,00000,00000,0,A,Boca Raton city,Florida,97422,97500,98000,98600,99000,99500,100100
162,12,000,17100,00000,00000,0,A,Delray Beach city,Florida,66846,66900,67000,67400,67800,68200,68600
`,
    );
    const pop = await readPopEstimates(path, '12');
    expect(pop.get('1207300')).toEqual({ base2020: 97422, pop2025: 100100 });
    expect(pop.size).toBe(2);
  });

  it('reads ACS place estimates and treats sentinels as missing', async () => {
    const path = file(
      'acs.dat',
      `GEO_ID|B25003_E001|B25003_M001|B25003_E002|B25003_M002
0400000US12|8800000|1000|5800000|1000
1600000US1207300|45000|500|31000|600
1600000US1217100|30000|400|-666666666|-222222222
1600000US0100124|900|50|700|40
`,
    );
    const acs = await readAcsPlaces(path, '12', ['B25003_E001', 'B25003_E002']);
    expect(acs.get('1207300')).toEqual([45000, 31000]);
    expect(acs.get('1217100')).toEqual([30000, null]);
    expect(acs.has('0100124')).toBe(false);
    await expect(readAcsPlaces(path, '12', ['B99999_E001'])).rejects.toThrow(/not in/);
  });

  it('reads ZIP-to-place land shares for the state', async () => {
    const path = file(
      'zcta.txt',
      `\uFEFFOID_ZCTA5_20|GEOID_ZCTA5_20|NAMELSAD_ZCTA5_20|AREALAND_ZCTA5_20|AREAWATER_ZCTA5_20|MTFCC_ZCTA5_20|CLASSFP_ZCTA5_20|FUNCSTAT_ZCTA5_20|OID_PLACE_20|GEOID_PLACE_20|NAMELSAD_PLACE_20|AREALAND_PLACE_20|AREAWATER_PLACE_20|MTFCC_PLACE_20|CLASSFP_PLACE_20|FUNCSTAT_PLACE_20|AREALAND_PART|AREAWATER_PART
||||||||1|1207300|Boca Raton city|75570156|6237074|G4110|C1|A|5000|0
1|33432|ZCTA5 33432|20000000|1|G6350|B5|S|2|1207300|Boca Raton city|75570156|6237074|G4110|C1|A|20000000|0
1|33444|ZCTA5 33444|30000000|1|G6350|B5|S|3|1217100|Delray Beach city|41290548|1535920|G4110|C1|A|15000000|0
1|36101|ZCTA5 36101|10000|1|G6350|B5|S|4|0151000|Montgomery city|1|1|G4110|C1|A|10000|0
`,
    );
    expect(await readZctaPlaces(path, '12')).toEqual([
      { zcta: '33432', place: '1207300', zctaLand: 20000000, partLand: 20000000 },
      { zcta: '33444', place: '1217100', zctaLand: 30000000, partLand: 15000000 },
    ]);
  });

  it('reads 4-digit establishment counts for the state from the ZIP file', async () => {
    const path = file(
      'zbp.txt',
      `"zip","name","naics","est","n<5","n5_9","n10_19","n20_49","n50_99","n100_249","n250_499","n500_999","n1000","city","stabbr","cty_name"
"33432","BOCA RATON, FL","------",4000,2000,"N","N","N","N","N","N","N","N","BOCA RATON","FL","PALM BEACH"
"33432","BOCA RATON, FL","2382//",60,30,"N","N","N","N","N","N","N","N","BOCA RATON","FL","PALM BEACH"
"33432","BOCA RATON, FL","238220",40,20,"N","N","N","N","N","N","N","N","BOCA RATON","FL","PALM BEACH"
"33432","BOCA RATON, FL","7225//",120,30,"N","N","N","N","N","N","N","N","BOCA RATON","FL","PALM BEACH"
"33444","DELRAY BEACH, FL","5411//",50,40,"N","N","N","N","N","N","N","N","DELRAY BEACH","FL","PALM BEACH"
"36104","MONTGOMERY, AL","5411//",90,40,"N","N","N","N","N","N","N","N","MONTGOMERY","AL","MONTGOMERY"
`,
    );
    const zips = await readZipBusiness(path, 'FL', ['2382', '5411', '7225']);
    expect([...zips.keys()]).toEqual(['33432', '33444']);
    expect(Object.fromEntries(zips.get('33432')!)).toEqual({ '2382': 60, '7225': 120 });
  });
});

describe('ranking', () => {
  const place = (geoid: string, name: string, lat: number, lon = -80.1) => ({
    geoid,
    name,
    censusName: `${name} city`,
    lat,
    lon,
    landSqMi: 10,
  });
  const facts = (): RankFacts => ({
    places: [
      place('1200001', 'Bigtown', 26.4),
      place('1200002', 'Midtown', 26.5),
      place('1200003', 'Tinyville', 26.6),
      place('1200004', 'Ourtown', 26.3),
      place('1200005', 'Faraway', 30.4),
    ],
    pop: new Map([
      ['1200001', { base2020: 90000, pop2025: 100000 }],
      ['1200002', { base2020: 40000, pop2025: 40000 }],
      ['1200003', { base2020: 3000, pop2025: 4000 }],
      ['1200004', { base2020: 50000, pop2025: 52000 }],
      ['1200005', { base2020: 20000, pop2025: 26000 }],
    ]),
    acs: new Map([
      ['1200001', [100000, 40000, 90000, 40000, 28000]],
      ['1200002', [40000, 16000, 60000, 16000, 9000]],
      ['1200005', [26000, 10000, 50000, 10000, 7000]],
    ]),
    zctaParts: [
      { zcta: '00001', place: '1200001', zctaLand: 100, partLand: 100 },
      { zcta: '00002', place: '1200002', zctaLand: 100, partLand: 50 },
      { zcta: '00002', place: '1200005', zctaLand: 100, partLand: 50 },
    ],
    zipBusiness: new Map([
      [
        '00001',
        new Map([
          ['2382', 100],
          ['7225', 50],
        ]),
      ],
      ['00002', new Map([['5411', 40]])],
    ]),
    existing: [{ geoid: '1200004', name: 'Ourtown', lat: 26.3, lon: -80.1 }],
  });

  it('percentiles run 0 to 1, ties share a value', () => {
    expect(percentiles([10, 30, 20])).toEqual([0, 1, 0.5]);
    expect(percentiles([5, 5])).toEqual([0.5, 0.5]);
    expect(percentiles([7])).toEqual([1]);
  });

  it('measures miles between places', () => {
    expect(
      Math.round(milesBetween({ lat: 26.3708, lon: -80.1026 }, { lat: 26.4559, lon: -80.0904 })),
    ).toBe(6);
  });

  it('filters, scores with the §10a weights and ranks', () => {
    const rows = rankPlaces(facts());
    // Tinyville is under 5,000 people; Ourtown is already ours.
    expect(rows.map((r) => r.name)).toEqual(['Bigtown', 'Midtown', 'Faraway']);
    const big = rows[0]!;
    expect(big.figures.businessValue).toBe(100 * 1 + 50 * 0.6);
    expect(big.figures.ownerShare).toBeCloseTo(0.7);
    expect(big.inputs).toMatchObject({
      business_value: 1,
      households_x_income: 1,
      source_readiness: 0.5,
      coverage_gap: 0.5,
      growth: 0.5,
    });
    // Seven miles from Ourtown: close to a cluster.
    expect(big.figures.nearestTown).toEqual({ name: 'Ourtown', miles: 7 });
    expect(big.inputs.cluster_fit).toBeCloseTo(0.93, 2);
    // Faraway grows fastest but sits beyond the cluster radius.
    const far = rows.find((r) => r.name === 'Faraway')!;
    expect(far.inputs.growth).toBe(1);
    expect(far.inputs.cluster_fit).toBe(0);
    // Shared ZIP: half of its legal offices count for each town.
    expect(far.figures.establishments).toEqual({ '5411': 20 });
  });

  it('limits the list to a radius around a town', () => {
    const rows = rankPlaces(facts(), { near: { lat: 26.3, lon: -80.1 }, radiusMiles: 20 });
    expect(rows.map((r) => r.name).sort()).toEqual(['Bigtown', 'Midtown']);
  });

  it('writes a CSV and a report that says what is neutral', () => {
    const rows = rankPlaces(facts());
    const csv = rankingCsv(rows);
    expect(csv.split('\n')[0]).toMatch(/^rank,geoid,name,score,input_business_value/);
    expect(csv.split('\n')[1]).toMatch(/^1,1200001,Bigtown,/);
    const md = rankingReport({ state: 'FL', rows, date: '2026-10-16', existing: facts().existing });
    expect(md).toContain('Nothing launches from this list until an admin approves the town');
    expect(md).toContain('neutral (0.5) for every town');
    expect(md).toContain('U.S. Census Bureau');
  });
});

describe('saving candidates', () => {
  let db: Db;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
  });
  afterAll(async () => drop());

  it('updates scores on a re-rank but never a staff decision', async () => {
    const place = {
      geoid: '1217100',
      name: 'Delray Beach',
      censusName: 'Delray Beach city',
      lat: 26.45,
      lon: -80.09,
      landSqMi: 16,
    };
    const facts: RankFacts = {
      places: [place],
      pop: new Map([['1217100', { base2020: 66846, pop2025: 68600 }]]),
      acs: new Map(),
      zctaParts: [],
      zipBusiness: new Map(),
      existing: [],
    };
    const rows = rankPlaces(facts);
    await saveCandidates(db, 'fl', rows, new Date('2026-10-16T12:00:00Z'));
    const [row] = await db.select().from(townCandidates);
    expect(row).toMatchObject({ state: 'FL', geoid: '1217100', status: 'proposed', rank: 1 });

    const [member] = await db
      .insert(staff)
      .values({ email: 'ed@towncore.net', name: 'Ed', role: 'admin' })
      .returning();
    await db
      .update(townCandidates)
      .set({ status: 'approved', decidedBy: member!.id, decidedAt: new Date() })
      .where(eq(townCandidates.geoid, '1217100'));
    await saveCandidates(db, 'FL', rows, new Date('2026-11-16T12:00:00Z'));
    const [again] = await db.select().from(townCandidates);
    expect(again).toMatchObject({ status: 'approved', decidedBy: member!.id });
    expect(again!.rankedAt).toEqual(new Date('2026-11-16T12:00:00Z'));
  });

  it('only admins decide; decisions are audited and a live town is never changed', async () => {
    const [candidate] = await listCandidates(db, { state: 'FL' });
    const [reviewer] = await db
      .insert(staff)
      .values({ email: 'rita@towncore.net', name: 'Rita', role: 'reviewer' })
      .returning();
    await expect(
      decideCandidate(db, {
        candidateId: candidate!.id,
        staff: { id: reviewer!.id, role: 'reviewer' },
        decision: 'reject',
      }),
    ).rejects.toThrow(CandidateDecisionError);
    const [admin] = await db.select().from(staff).where(eq(staff.role, 'admin'));
    const rejected = await decideCandidate(db, {
      candidateId: candidate!.id,
      staff: { id: admin!.id, role: 'admin' },
      decision: 'reject',
      note: 'A paper already covers it closely.',
    });
    expect(rejected).toMatchObject({
      status: 'rejected',
      note: 'A paper already covers it closely.',
    });
    const reopened = await decideCandidate(db, {
      candidateId: candidate!.id,
      staff: { id: admin!.id, role: 'admin' },
      decision: 'reopen',
    });
    expect(reopened).toMatchObject({ status: 'proposed', decidedBy: null, decidedAt: null });
    expect((await db.select().from(adminActions)).map((a) => a.action)).toEqual([
      'launch.candidate.reject',
      'launch.candidate.reopen',
    ]);
    await db.update(townCandidates).set({ status: 'live' });
    await expect(
      decideCandidate(db, {
        candidateId: candidate!.id,
        staff: { id: admin!.id, role: 'admin' },
        decision: 'approve',
      }),
    ).rejects.toThrow(/already live/);
  });
});
