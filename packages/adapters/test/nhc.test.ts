import { fileURLToPath } from 'node:url';
import { tropicsLine } from '@towncore/config';
import { describe, expect, it } from 'vitest';
import { Fetcher } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import { fetchTropics, outlookAreas, outlookParagraphs } from '../src/nhc';

// Recorded live from www.nhc.noaa.gov (robots.txt `Disallow:` empty) on 2026-10-17: Hurricane
// Trudy in the eastern Pacific, a disturbance off southern Mexico, a quiet Atlantic.
const fixture = fileURLToPath(new URL('../fixtures/nhc/2026-10-17.json', import.meta.url));
const fetcher = () =>
  new Fetcher({
    fetchImpl: replayFetch(fixture),
    sleep: async () => {},
    now: () => 0,
    minIntervalMs: 0,
  });

describe('National Hurricane Center', () => {
  it('reads every basin from two shared files', async () => {
    const basins = await fetchTropics(fetcher());
    expect(basins.map((b) => b.basin)).toEqual(['atlantic', 'east-pacific', 'central-pacific']);
    const [atlantic, east, central] = basins;
    expect(atlantic!.storms).toEqual([]);
    expect(atlantic!.outlook?.text).toMatch(/^For the North Atlantic/);
    expect(atlantic!.outlook?.text).toContain('not expected during the next 7 days');
    expect(atlantic!.outlook?.text).not.toMatch(/KNHC|Forecaster|\$\$/);
    expect(east!.storms).toEqual([
      expect.objectContaining({
        name: 'Trudy',
        classification: 'HU',
        windKt: 80,
        movement: { direction: 325, mph: 10 },
        advisory: expect.objectContaining({ number: '17' }),
      }),
    ]);
    expect(east!.outlook?.areas).toEqual([
      { title: 'South of Southern Mexico', twoDay: 0, sevenDay: 70 },
    ]);
    expect(central!.storms).toEqual([]);
  });

  it('gives each basin one line when something is active or likely', async () => {
    const [atlantic, east] = await fetchTropics(fetcher());
    expect(tropicsLine(atlantic!)).toBeNull();
    // NHC's 80 knots is its advisory's 90 mph.
    expect(tropicsLine(east!)).toBe('Hurricane Trudy, 90 mph winds');
    expect(tropicsLine({ ...east!, storms: [] })).toBe(
      'Hurricane Center watching South of Southern Mexico: 70% chance in 7 days',
    );
  });

  it('reads numbered Atlantic areas and their chances', () => {
    const html =
      'Tropical Weather Outlook<br>NWS National Hurricane Center Miami FL<br><br>For the North Atlantic...Caribbean Sea and the Gulf of America:<br><br>1. Central Tropical Atlantic (AL94):<br>Showers and thunderstorms have become better organized.<br>* Formation chance through 48 hours...medium...40 percent.<br>* Formation chance through 7 days...high...80 percent.<br><br>2. Western Caribbean Sea:<br>A broad area of low pressure could form.<br>* Formation chance through 48 hours...low...near 0 percent.<br>* Formation chance through 7 days...low...20 percent.<br><br>$$<br>Forecaster Beven';
    const paragraphs = outlookParagraphs(html);
    expect(paragraphs[0]).toMatch(/^For the North Atlantic/);
    expect(paragraphs.at(-1)).toMatch(/20 percent\.$/);
    expect(outlookAreas(paragraphs)).toEqual([
      { title: 'Central Tropical Atlantic (AL94)', twoDay: 40, sevenDay: 80 },
      { title: 'Western Caribbean Sea', twoDay: 0, sevenDay: 20 },
    ]);
  });
});
