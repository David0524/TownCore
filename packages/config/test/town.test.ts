import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { guideTopic } from '../src/guides';
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
pricing: { featured_usd: [19, 12, 7], enhanced_usd: 39 }
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

  it('Boca has only verified sources', () => {
    const boca = loadTownConfigs(townsDir).find((t) => t.slug === 'boca-raton')!;
    expect(findTbdFields(boca)).toEqual([]);
    expect(boca.sources.map((s) => `${s.kind}/${s.platform}`)).toEqual([
      'agenda/civicplus',
      // The city's event calendars (community events, the Explorium, Gumbo Limbo, …).
      ...Array<string>(10).fill('events/civicplus'),
      'city_news/civicplus',
      // Police and fire releases from their News Flash list pages.
      'police/civicplus',
      'fire/civicplus',
      'federal_awards/usaspending',
      'health_facilities/cms',
      'business_filings/fl-dbpr',
      'business_filings/fl-dbpr',
      'business_filings/fl-dbpr',
      'inspections/fl-dbpr',
      'business_filings/fl-dbpr',
      'city_news/feed',
      'roads/pdf-list',
      // The city's development projects map, one ArcGIS layer per stage.
      'permits/arcgis',
      'business_filings/fl-sunbiz',
      'weather/nws',
      // From counties/fl/palm-beach.yaml (county_sources), appended last.
      'property_sales/arcgis',
    ]);
  });

  it('Boca has 30 guide topics, each from official pages over https', () => {
    const boca = loadTownConfigs(townsDir).find((t) => t.slug === 'boca-raton')!;
    expect(boca.guides).toHaveLength(30);
    for (const guide of boca.guides) {
      expect(guideTopic(guide.topic), guide.topic).toBeDefined();
      for (const page of guide.pages) {
        // Government sites, plus the county school district's own domain.
        expect(new URL(page).hostname).toMatch(
          /(^|\.)(myboca\.us|floridadisaster\.org|dos\.fl\.gov|pbcpao\.gov|pbctax\.gov|palmbeachschools\.org)$/,
        );
      }
    }
  });

  it('rejects unknown guide topics, repeated topics and plain-http pages', () => {
    const guides = (body: string) => parseTownConfig(`${minimal}\nguides:\n${body}`);
    expect(() => guides('  - { topic: astrology, pages: [https://city.example/a] }')).toThrow(
      /topic/,
    );
    expect(() =>
      guides(
        '  - { topic: recycling, pages: [https://city.example/a] }\n  - { topic: recycling, pages: [https://city.example/b] }',
      ),
    ).toThrow(/only once/);
    expect(() => guides('  - { topic: recycling, pages: [http://city.example/a] }')).toThrow();
    expect(() => guides('  - { topic: recycling, pages: [] }')).toThrow();
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
