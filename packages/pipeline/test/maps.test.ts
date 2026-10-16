import { fileURLToPath } from 'node:url';
import type { Fetcher } from '@towncore/adapters';
import { loadTowns, MAP_VIEW } from '@towncore/config';
import {
  articles,
  eq,
  getTownBySlug,
  images,
  syncTowns,
  townBasemaps,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assignArticleImage } from '../src/images';
import {
  blockLabel,
  blockOf,
  buildMapSpec,
  findStreetAddress,
  geocodeBlock,
  mapAlt,
  streetKey,
  type BasemapLines,
} from '../src/maps';

// Block-level maps (CLAUDE.md §11c; docs/plans/M4.md §3).
const CENTER: [number, number] = [-80.09, 26.35];
// 0.001° of latitude is about 111 m: a small grid of streets around the center.
const LINES: BasemapLines = [
  {
    c: 'major',
    n: 'Palmetto Park Road',
    p: [
      [-80.1, 26.35],
      [-80.08, 26.35],
    ],
  },
  {
    c: 'secondary',
    n: 'NW 2nd Avenue',
    p: [
      [-80.09, 26.34],
      [-80.09, 26.36],
    ],
  },
  {
    c: 'minor',
    n: 'NW 1st Street',
    p: [
      [-80.095, 26.352],
      [-80.085, 26.352],
    ],
  },
  {
    c: 'water',
    p: [
      [-80.087, 26.34],
      [-80.087, 26.36],
    ],
  },
  // Far outside the view: dropped.
  {
    c: 'major',
    n: 'Glades Road',
    p: [
      [-80.2, 26.4],
      [-80.19, 26.4],
    ],
  },
];

describe('street addresses and blocks', () => {
  it('finds the first street address and its block', () => {
    expect(
      findStreetAddress('Work starts Monday at 1234 W. Palmetto Park Road. Lanes will close.'),
    ).toEqual({ number: 1234, street: 'W. Palmetto Park Road' });
    expect(findStreetAddress('Permits for 201 NW 2nd Ave and more')).toEqual({
      number: 201,
      street: 'NW 2nd Ave',
    });
    expect(findStreetAddress('The council voted 4-1 on Tuesday.')).toBeNull();
    expect(blockOf(1234)).toBe(1200);
    expect(streetKey('W. Palmetto Park Rd')).toBe(streetKey('West Palmetto Park Road'));
    expect(blockLabel(1234, 'NW 2nd Ave')).toBe('1200 block of NW 2nd Ave');
    expect(blockLabel(42, 'NW 2nd Ave')).toBe('First block of NW 2nd Ave');
  });

  it('geocodes the middle of the block, never the address given', async () => {
    const urls: string[] = [];
    const fetcher = {
      getJson: async (url: string) => {
        urls.push(url);
        return { result: { addressMatches: [{ coordinates: { x: -80.09, y: 26.35 } }] } };
      },
    } as unknown as Fetcher;
    const point = await geocodeBlock(
      fetcher,
      { number: 1234, street: 'NW 2nd Ave' },
      { name: 'Boca Raton', state: 'FL' },
    );
    expect(point).toEqual([-80.09, 26.35]);
    const street = new URL(urls[0]!).searchParams.get('street');
    expect(street).toBe('1250 NW 2nd Ave');
    expect(urls[0]).not.toContain('1234');
  });
});

describe('map spec', () => {
  it('projects lines into the view, labels the larger roads and marks the block', () => {
    const spec = buildMapSpec(LINES, CENTER, '1200 block of NW 2nd Ave', 'NW 2nd Ave');
    expect(spec.lines.map((l) => l.c)).toEqual(['major', 'secondary', 'minor', 'water']);
    // The center lands in the middle of the view.
    expect(spec.marker.x).toBe(MAP_VIEW.width / 2);
    expect(spec.marker.y).toBe(MAP_VIEW.height / 2);
    expect(spec.lines[0]!.d).toMatch(/^M-?[\d.]+ 337\.5L/);
    // Minor streets and water are not labeled.
    expect(spec.labels.map((l) => l.text).sort()).toEqual(['NW 2nd Avenue', 'Palmetto Park Road']);
    expect(spec.labels.find((l) => l.text === 'NW 2nd Avenue')!.angle).toBe(-90);
    expect(mapAlt(spec, 'Boca Raton')).toBe(
      'Street map of Boca Raton centered on the 1200 block of NW 2nd Ave, with Palmetto Park Road nearby. The marked area shows the block, not an exact address.',
    );
  });
});

describe('router: maps', () => {
  const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));
  let db: Db;
  let drop: () => Promise<void>;
  let townId: string;
  let calls = 0;
  const fetcher = {
    getJson: async () => {
      calls++;
      return { result: { addressMatches: [{ coordinates: { x: -80.09, y: 26.35 } }] } };
    },
  } as unknown as Fetcher;

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
  beforeEach(async () => {
    calls = 0;
    await db.delete(articles);
    await db.delete(townBasemaps);
  });

  let n = 0;
  async function story(bodyMd: string) {
    const [a] = await db
      .insert(articles)
      .values({
        townId,
        slug: `map-${++n}`,
        headline: 'Road work on NW 2nd Avenue',
        bodyMd,
        beat: 'development',
        tier: 2,
        status: 'published',
        byline: 'Boca Town Square Newsroom',
        sourceRecordIds: ['00000000-0000-4000-8000-000000000001'],
        publishedAt: new Date(),
        promptVersions: ['writer@v1'],
      })
      .returning();
    return a!;
  }
  const seedBasemap = () =>
    db.insert(townBasemaps).values({
      townId,
      bbox: [-80.2, 26.2, -80.0, 26.5],
      lines: LINES,
      sourceUrl: 'https://download.example/florida.osm.pbf',
      extractedAt: new Date(),
    });

  it('draws a block-level map with the ODbL credit when a base map exists', async () => {
    await seedBasemap();
    const a = await story('Crews will repave the 1234 NW 2nd Ave block starting Monday.');
    const choice = await assignArticleImage(db, a.id, { fetcher });
    expect(choice.kind).toBe('map');
    expect(choice.attribution).toBe('© OpenStreetMap contributors');
    expect(choice.license).toBe('ODbL-1.0');
    expect(JSON.stringify(choice.spec)).not.toContain('1234');
    const [row] = await db.select().from(images).where(eq(images.articleId, a.id));
    expect(row!.kind).toBe('map');
    expect(row!.mapCheckedAt).not.toBeNull();
  });

  it('falls back without a base map, an address or the fetcher, and never geocodes then', async () => {
    const a = await story('Crews will repave 1234 NW 2nd Ave starting Monday.');
    expect((await assignArticleImage(db, a.id, { fetcher })).kind).toBe('typographic-card');
    await seedBasemap();
    const b = await story('The council approved the paving plan.');
    expect((await assignArticleImage(db, b.id, { fetcher })).kind).toBe('typographic-card');
    expect(calls).toBe(0);
    const c = await story('Crews will repave 1234 NW 2nd Ave starting Monday.');
    expect((await assignArticleImage(db, c.id)).kind).toBe('typographic-card');
    const [row] = await db.select().from(images).where(eq(images.articleId, c.id));
    expect(row!.mapCheckedAt).toBeNull();
  });
});
