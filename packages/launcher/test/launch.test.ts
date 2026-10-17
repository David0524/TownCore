import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Fetcher } from '@towncore/adapters';
import { parseTownConfig } from '@towncore/config';
import { eq, launchStepRecords, launches, townCandidates, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  draftTownYaml,
  governmentName,
  LaunchRefused,
  nwsPoint,
  parseGazetteerCounties,
  readPlaceCounties,
  resolveFrom,
  runLaunch,
  townSlug,
  type ResolvedTown,
} from '../src';

// pnpm launch, step 1 (M7 PR B, CLAUDE.md §10). Samples are short excerpts in the published
// layouts; the NWS response is the shape api.weather.gov/points returns.

const dir = mkdtempSync(join(tmpdir(), 'launch-'));

describe('resolving a town', () => {
  it('names slugs and governments the way the Census writes them', () => {
    expect(townSlug('Delray Beach')).toBe('delray-beach');
    expect(townSlug("Coeur d'Alene")).toBe('coeur-d-alene');
    expect(townSlug('Española')).toBe('espanola');
    expect(governmentName('Delray Beach city', 'Delray Beach')).toBe('City of Delray Beach');
    expect(governmentName('Lake Park town', 'Lake Park')).toBe('Town of Lake Park');
    expect(
      governmentName(
        'Nashville-Davidson metropolitan government (balance)',
        'Nashville-Davidson metropolitan government (balance)',
      ),
    ).toBe('Nashville-Davidson metropolitan government (balance)');
  });

  it('reads county names and the county holding most of a place', async () => {
    const counties = parseGazetteerCounties(
      `USPS|GEOID|GEOIDFQ|ANSICODE|NAME|ALAND|AWATER|ALAND_SQMI|AWATER_SQMI|INTPTLAT|INTPTLONG
FL|12099|0500000US12099|00295757|Palm Beach County|5100000000|1000|1970|5|26.6|-80.4
LA|22071|0500000US22071|00558097|Orleans Parish|440000000|1000|169|1|30.0|-89.9
`,
    );
    expect(counties.get('12099')).toBe('Palm Beach');
    expect(counties.get('22071')).toBe('Orleans');
    const pop = join(dir, 'pop.csv');
    writeFileSync(
      pop,
      `SUMLEV,STATE,COUNTY,PLACE,COUSUB,CONCIT,PRIMGEO_FLAG,FUNCSTAT,NAME,STNAME,ESTIMATESBASE2020,POPESTIMATE2020,POPESTIMATE2021,POPESTIMATE2022,POPESTIMATE2023,POPESTIMATE2024,POPESTIMATE2025
162,12,000,17100,00000,00000,0,A,Delray Beach city,Florida,66846,66900,67000,67400,67800,68200,69809
157,12,099,17100,00000,00000,1,A,Delray Beach city,Florida,66846,66900,67000,67400,67800,68200,69809
157,12,011,99999,00000,00000,1,A,Split city,Florida,100,100,100,100,100,100,120
157,12,099,99999,00000,00000,0,A,Split city,Florida,5000,5000,5000,5000,5000,5000,5100
`,
    );
    const byPlace = await readPlaceCounties(pop, '12');
    expect(byPlace.get('1217100')).toBe('12099');
    expect(byPlace.get('1299999')).toBe('12099');
  });

  it('asks NWS for the zone, office and timezone of a point', async () => {
    const urls: string[] = [];
    const fetcher = new Fetcher({
      fetchImpl: async (url) => {
        urls.push(String(url));
        return new Response(
          JSON.stringify({
            properties: {
              forecastZone: 'https://api.weather.gov/zones/forecast/FLZ068',
              gridId: 'MFL',
              timeZone: 'America/New_York',
            },
          }),
          { headers: { 'content-type': 'application/geo+json' } },
        );
      },
    });
    expect(await nwsPoint(fetcher, 26.455903, -80.09042)).toEqual({
      zone: 'FLZ068',
      office: 'MFL',
      timezone: 'America/New_York',
    });
    expect(urls).toEqual(['https://api.weather.gov/points/26.4559,-80.0904']);
  });

  it('resolves the facts and same-name towns in other states', () => {
    const place = (geoid: string, state: string, name = 'Springfield') => ({
      geoid,
      state,
      name,
      censusName: `${name} city`,
      lat: 39.8,
      lon: -89.65,
      landSqMi: 60,
    });
    const town = resolveFrom({
      place: place('1772000', 'IL'),
      state: 'IL',
      county: 'Sangamon',
      population2025: 112_000,
      nws: { zone: 'ILZ051', office: 'ILX', timezone: 'America/Chicago' },
      sameName: [
        place('1772000', 'IL'),
        place('2967000', 'MO'),
        place('2562535', 'MA'),
        place('3900001', 'OH', 'Springdale'),
      ],
    });
    expect(town).toMatchObject({
      slug: 'springfield',
      censusId: '1772000',
      tier: 'large',
      timezone: 'America/Chicago',
      nws: { zone: 'ILZ051', point: '39.8000,-89.6500' },
      sameNameElsewhere: ['Springfield, MA', 'Springfield, MO'],
      agencies: ['City of Springfield'],
    });
  });
});

const DELRAY: ResolvedTown = {
  slug: 'delray-beach',
  name: 'Delray Beach',
  state: 'FL',
  censusId: '1217100',
  censusName: 'Delray Beach city',
  county: 'Palm Beach',
  timezone: 'America/New_York',
  tier: 'mid',
  population2025: 69809,
  lat: 26.455903,
  lon: -80.09042,
  nws: { zone: 'FLZ068', office: 'MFL', point: '26.4559,-80.0904' },
  sameNameElsewhere: [],
  agencies: ['City of Delray Beach'],
};

describe('the draft town config', () => {
  it('is valid town config once step 2 fills the name and domain', () => {
    const yaml = draftTownYaml(DELRAY, {
      town: 'Delray Beach, FL',
      domain: 'delraytownsquare.com',
    });
    expect(yaml).toContain('site_name: TBD');
    const filled = yaml.replace('site_name: TBD', "site_name: 'Delray Daily'");
    expect(parseTownConfig(filled)).toMatchObject({
      slug: 'delray-beach',
      census_id: '1217100',
      tier: 'mid',
      domain: 'delraytownsquare.com',
      sources: [{ kind: 'weather', platform: 'nws', zone: 'FLZ068', point: '26.4559,-80.0904' }],
    });
  });
});

describe('a launch run', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let resolveCalls = 0;
  let failNext = false;
  const deps = () => ({
    db,
    launchDir: dir,
    resolve: async (town: string) => {
      resolveCalls++;
      if (failNext) {
        failNext = false;
        throw new Error('NWS has no forecast zone for 0,0');
      }
      expect(town).toBe('Delray Beach, FL');
      return DELRAY;
    },
  });

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    await db.insert(townCandidates).values({
      state: 'FL',
      geoid: '1217100',
      name: 'Delray Beach',
      inputs: {},
      score: 0.685,
      rank: 13,
      rankedAt: new Date(),
    });
  });
  afterAll(async () => drop());

  it('refuses towns that are unranked or not approved', async () => {
    await expect(runLaunch(deps(), { town: 'Delray Beach' })).rejects.toThrow(/"Name, ST"/);
    await expect(runLaunch(deps(), { town: 'Nowhere, FL' })).rejects.toThrow(/hasn't been ranked/);
    await expect(runLaunch(deps(), { town: 'Delray Beach, FL' })).rejects.toThrow(
      /proposed, not approved/,
    );
    expect(await db.select().from(launches)).toHaveLength(0);
  });

  it('records a failed step and resumes it', async () => {
    await db.update(townCandidates).set({ status: 'approved' });
    failNext = true;
    const first = await runLaunch(deps(), { town: 'delray beach, fl' });
    expect(first.launch).toMatchObject({ status: 'failed', dryRun: true });
    expect(first.launch.stoppedReason).toMatch(/Resolve the town: NWS has no forecast zone/);
    expect(first.steps[0]).toMatchObject({ step: 'resolve', status: 'failed', attempts: 1 });
    await expect(runLaunch(deps(), { town: 'Delray Beach, FL' })).rejects.toThrow(LaunchRefused);

    const again = await runLaunch(deps(), { town: 'Delray Beach, FL', resume: true });
    expect(again.launch).toMatchObject({
      id: first.launch.id,
      status: 'failed',
      slug: 'delray-beach',
    });
    // Step 2 needs the registrar (names.test.ts); without it the run stops there.
    expect(again.launch.stoppedReason).toMatch(/Names and domains: No domain registrar/);
    expect(again.steps.map((s) => [s.step, s.status])).toEqual([
      ['resolve', 'done'],
      ['names', 'failed'],
      ['mail', 'pending'],
      ['sources', 'pending'],
      ['adapters', 'pending'],
      ['readiness', 'pending'],
      ['seed', 'pending'],
      ['theme', 'pending'],
      ['provision', 'pending'],
      ['report', 'pending'],
    ]);
    expect(again.steps[0]).toMatchObject({ attempts: 2, error: null });
    expect(again.files).toEqual([join(dir, 'delray-beach', 'delray-beach.draft.yaml')]);
    expect(readFileSync(again.files[0]!, 'utf8')).toContain("census_id: '1217100'");
  });

  it('never repeats a finished step', async () => {
    const before = resolveCalls;
    const third = await runLaunch(deps(), {
      town: 'Delray Beach, FL',
      resume: true,
      approveSpend: true,
    });
    expect(resolveCalls).toBe(before);
    expect(third.launch.dryRun).toBe(false);
    const [row] = await db
      .select()
      .from(launchStepRecords)
      .where(eq(launchStepRecords.step, 'resolve'));
    expect(row!.detail).toMatchObject({ censusId: '1217100', county: 'Palm Beach' });
  });
});
