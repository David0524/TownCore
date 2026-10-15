import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findTbdFields, loadTownConfigs, parseTownConfig } from '../src/town';

const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));

const minimal = `
slug: test-town
name: Test Town
state: FL
county: Test
timezone: America/New_York
site_name: Test Town Square
domain: testtownsquare.com
tier: small
newsletter_send_time: "06:30"
agencies: [City of Test Town]
pricing: { sponsored_slot_usd: 199, enhanced_usd: 39 }
`;

describe('town config', () => {
  it('loads every town in the repo, including Boca Raton', () => {
    const towns = loadTownConfigs(townsDir);
    const boca = towns.find((t) => t.slug === 'boca-raton');
    expect(boca).toMatchObject({
      site_name: 'Boca Town Square',
      domain: 'bocatownsquare.com',
      timezone: 'America/New_York',
      tier: 'large',
    });
  });

  it('Boca still has TBD sources (filled in M2)', () => {
    const boca = loadTownConfigs(townsDir).find((t) => t.slug === 'boca-raton')!;
    expect(findTbdFields(boca)).toEqual([
      'sources[0].platform',
      'sources[0].url',
      'sources[1].zone',
    ]);
  });

  it('applies defaults', () => {
    expect(parseTownConfig(minimal)).toMatchObject({
      extra_domains: [],
      sources: [],
      same_name_elsewhere: [],
    });
  });

  it('rejects brand overrides and other unknown keys', () => {
    expect(() => parseTownConfig(`${minimal}\ncolors: { brick: "#FF0000" }`)).toThrow(/colors/);
    expect(() => parseTownConfig(`${minimal}\nprimary_color: "#FF0000"`)).toThrow(/primary_color/);
  });

  it('rejects bad values', () => {
    expect(() => parseTownConfig(minimal.replace('America/New_York', 'Mars/Olympus'))).toThrow(
      /timezone/,
    );
    expect(() =>
      parseTownConfig(minimal.replace('testtownsquare.com', 'www.testtownsquare.com')),
    ).toThrow();
    expect(() => parseTownConfig(minimal.replace('"06:30"', '"6:30am"'))).toThrow();
    expect(() => parseTownConfig(minimal.replace('state: FL', 'state: Florida'))).toThrow();
  });

  it('requires the file path to match state and slug, and rejects duplicates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'towns-'));
    mkdirSync(join(dir, 'fl'));
    writeFileSync(join(dir, 'fl', 'wrong-name.yaml'), minimal);
    expect(() => loadTownConfigs(dir)).toThrow(/towns\/fl\/test-town\.yaml/);

    const dir2 = mkdtempSync(join(tmpdir(), 'towns-'));
    mkdirSync(join(dir2, 'fl'));
    writeFileSync(join(dir2, 'fl', 'test-town.yaml'), minimal);
    writeFileSync(
      join(dir2, 'fl', 'other-town.yaml'),
      minimal.replace('slug: test-town', 'slug: other-town'),
    );
    expect(() => loadTownConfigs(dir2)).toThrow(/Duplicate town domain/);
  });
});
