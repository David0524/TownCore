import { describe, expect, it } from 'vitest';
import {
  advanceSnapshot,
  snapshotCovers,
  type WeatherPeriod,
  type WeatherSnapshot,
} from '../src/weather';

// The tile's "now" at view time (rollout plan, Phase 1: forecasts are refreshed in turn, so a
// stored forecast can be a few hours old; the current hour comes from its hourly periods).

const hour = (iso: string, temperature: number): WeatherPeriod => ({
  startTime: iso,
  temperature,
  shortForecast: `Forecast ${iso.slice(11, 13)}`,
  precipChance: null,
  windSpeed: '5 mph',
  windDirection: 'E',
  unit: 'F',
});

// Hourly periods from 10 a.m. Oct. 17 to 9 p.m. Oct. 18, Eastern daylight time.
const upcoming = Array.from({ length: 36 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 17, 14 + i));
  const local = new Date(d.getTime() - 4 * 3_600_000).toISOString().slice(0, 13);
  // Warmest at 3 p.m., coolest at 6 a.m.
  const h = (10 + i) % 24;
  return hour(`${local}:00:00-04:00`, 70 + Math.round(10 * Math.cos(((h - 15) * Math.PI) / 12)));
});
const base: WeatherSnapshot = {
  place: 'Boca Raton, FL',
  grid: { office: 'MFL', x: 111, y: 77 },
  updatedAt: '2026-10-17T13:30:00Z',
  now: upcoming[0]!,
  hours: [],
  upcoming,
  today: { name: '', high: null, low: null, shortForecast: '' },
  alerts: [
    {
      id: 'over',
      event: 'A',
      headline: null,
      severity: 'Minor',
      until: '2026-10-17T15:00:00Z',
      url: 'x',
    },
    { id: 'on', event: 'B', headline: null, severity: 'Minor', until: null, url: 'x' },
  ],
  sourceUrl: 'https://forecast.weather.gov/',
};

describe('advanceSnapshot', () => {
  it('picks the current hour, the hourly row, the high and the low', () => {
    const w = advanceSnapshot(base, new Date('2026-10-17T16:20:00Z')); // 12:20 p.m. EDT
    expect(w.now.startTime).toBe('2026-10-17T12:00:00-04:00');
    expect(w.hours.map((h) => h.startTime.slice(11, 13))).toEqual([
      '12',
      '14',
      '16',
      '18',
      '20',
      '22',
    ]);
    expect(w.today).toMatchObject({ name: 'Today', high: 80, shortForecast: 'Forecast 12' });
    expect(w.today.low).toBe(
      Math.min(
        ...upcoming
          .filter(
            (p) =>
              p.startTime.startsWith('2026-10-17T2') ||
              (p.startTime.startsWith('2026-10-18') && Number(p.startTime.slice(11, 13)) < 8),
          )
          .map((p) => p.temperature),
      ),
    );
    expect(w.alerts.map((a) => a.id)).toEqual(['on']);
  });

  it('says tonight after 3 p.m., with only a low', () => {
    const w = advanceSnapshot(base, new Date('2026-10-17T23:05:00Z')); // 7:05 p.m. EDT
    expect(w.now.startTime).toBe('2026-10-17T19:00:00-04:00');
    expect(w.today).toMatchObject({ name: 'Tonight', high: null });
    expect(w.today.low).toBe(60);
  });

  it('leaves an old snapshot without hourly periods as it is, and knows when periods run out', () => {
    const { upcoming: _drop, ...old } = base;
    expect(advanceSnapshot(old, new Date('2026-10-17T23:05:00Z'))).toBe(old);
    expect(snapshotCovers(base, new Date('2026-10-19T01:30:00Z'))).toBe(true); // 9:30 p.m. Oct. 18
    expect(snapshotCovers(base, new Date('2026-10-19T02:30:00Z'))).toBe(false);
    expect(snapshotCovers(old, new Date('2026-10-17T16:00:00Z'))).toBe(false);
  });
});
