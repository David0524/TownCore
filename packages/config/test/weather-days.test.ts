import { describe, expect, it } from 'vitest';
import {
  advanceDays,
  advanceSnapshot,
  conditionKind,
  daysDue,
  daysFromPeriods,
  feelsLike,
  heatIndex,
  windChill,
  WEATHER_DAYS_EVERY_MS,
  WEATHER_DAYS_MAX_AGE_MS,
  type ForecastPeriod,
  type SevenDayForecast,
  type WeatherSnapshot,
} from '../src/weather';

// The Weather page's 7-day list (the NWS 12-hour forecast), its icons' kinds and feels-like.

const period = (
  name: string,
  isDaytime: boolean,
  temperature: number,
  start: string,
  end: string,
  extra: Partial<ForecastPeriod> = {},
): ForecastPeriod => ({
  name,
  startTime: start,
  endTime: end,
  isDaytime,
  temperature,
  shortForecast: 'Sunny',
  detailedForecast: `${name} text.`,
  precipChance: null,
  windSpeed: '10 mph',
  windDirection: 'E',
  ...extra,
});

/** A forecast issued in the afternoon: day, night, day, night… for 7 days. */
const fromDay = Array.from({ length: 14 }, (_, i) => {
  const day = 16 + Math.floor(i / 2);
  const isDaytime = i % 2 === 0;
  const start = isDaytime ? `2026-10-${day}T06:00:00-04:00` : `2026-10-${day}T18:00:00-04:00`;
  const end = isDaytime ? `2026-10-${day}T18:00:00-04:00` : `2026-10-${day + 1}T06:00:00-04:00`;
  const name = i === 0 ? 'Today' : i === 1 ? 'Tonight' : isDaytime ? `Day ${day}` : `Night ${day}`;
  return period(name, isDaytime, isDaytime ? 84 - i : 72 - i, start, end, {
    precipChance: isDaytime ? 20 : 40,
  });
});

describe('daysFromPeriods', () => {
  it('pairs each day with the night after it, up to 7 days', () => {
    const days = daysFromPeriods(fromDay);
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({
      name: 'Today',
      isDaytime: true,
      high: 84,
      low: 71,
      shortForecast: 'Sunny',
      detail: ['Today text.', 'Tonight text.'],
      precipChance: 40,
      kind: 'clear',
    });
    expect(days.map((d) => d.name)).toEqual([
      'Today',
      'Day 17',
      'Day 18',
      'Day 19',
      'Day 20',
      'Day 21',
      'Day 22',
    ]);
  });

  it('leads with "Tonight" alone when the forecast starts at night', () => {
    const days = daysFromPeriods(fromDay.slice(1));
    expect(days[0]).toMatchObject({ name: 'Tonight', isDaytime: false, high: null, low: 71 });
    expect(days[1]).toMatchObject({ name: 'Day 17', high: 82, low: 69 });
    expect(days).toHaveLength(7);
  });

  it('handles a last day without its night, and missing chances', () => {
    const days = daysFromPeriods([fromDay[12]!].map((p) => ({ ...p, precipChance: null })));
    expect(days).toEqual([expect.objectContaining({ high: 72, low: null, precipChance: null })]);
    expect(daysFromPeriods([])).toEqual([]);
  });
});

describe('advanceDays and the snapshot', () => {
  const fetchedAt = '2026-10-16T14:00:00Z';
  const days: SevenDayForecast = { updatedAt: fetchedAt, fetchedAt, periods: fromDay };

  it('drops ended periods as the clock moves, so the list turns to "Tonight"', () => {
    const evening = new Date('2026-10-16T23:00:00Z'); // 7 p.m. EDT
    expect(advanceDays(days, evening)!.periods[0]!.name).toBe('Tonight');
    expect(daysFromPeriods(advanceDays(days, evening)!.periods)[0]!.name).toBe('Tonight');
  });

  it('shows nothing once the forecast is too old', () => {
    const old = new Date(new Date(fetchedAt).getTime() + WEATHER_DAYS_MAX_AGE_MS + 1);
    expect(advanceDays(days, old)).toBeUndefined();
    expect(advanceDays(undefined, old)).toBeUndefined();
  });

  it('is applied by advanceSnapshot', () => {
    const hour = {
      startTime: '2026-10-16T19:00:00-04:00',
      temperature: 80,
      shortForecast: 'Clear',
      precipChance: null,
      windSpeed: '5 mph',
      windDirection: 'E',
      unit: 'F',
    };
    const snapshot: WeatherSnapshot = {
      place: 'Boca Raton, FL',
      grid: { office: 'MFL', x: 1, y: 1 },
      updatedAt: fetchedAt,
      now: hour,
      hours: [],
      upcoming: [hour],
      today: { name: '', high: null, low: null, shortForecast: 'Clear' },
      alerts: [],
      sourceUrl: 'https://forecast.weather.gov/',
      days,
    };
    const at = new Date('2026-10-16T23:10:00Z');
    expect(advanceSnapshot(snapshot, at).days!.periods[0]!.name).toBe('Tonight');
    const late = new Date(new Date(fetchedAt).getTime() + WEATHER_DAYS_MAX_AGE_MS + 1);
    expect(advanceSnapshot(snapshot, late)).not.toHaveProperty('days');
  });

  it('is due when missing or an hour old', () => {
    const at = new Date(fetchedAt);
    expect(daysDue(null, at)).toBe(true);
    expect(daysDue({ days: undefined }, at)).toBe(true);
    expect(daysDue({ days }, new Date(at.getTime() + WEATHER_DAYS_EVERY_MS - 1))).toBe(false);
    expect(daysDue({ days }, new Date(at.getTime() + WEATHER_DAYS_EVERY_MS))).toBe(true);
    expect(daysDue({ days }, new Date(at.getTime() + WEATHER_DAYS_EVERY_MS), 6 * 3_600_000)).toBe(
      false,
    );
  });
});

describe('conditionKind', () => {
  it.each([
    ['Sunny', 'clear'],
    ['Clear', 'clear'],
    ['Hot', 'clear'],
    ['Mostly Sunny', 'partly-cloudy'],
    ['Partly Cloudy', 'partly-cloudy'],
    ['Mostly Clear', 'partly-cloudy'],
    ['Mostly Cloudy', 'cloudy'],
    ['Cloudy', 'cloudy'],
    ['Patchy Fog', 'fog'],
    ['Haze', 'fog'],
    ['Breezy', 'wind'],
    ['Sunny and Windy', 'wind'],
    ['Light Rain', 'rain'],
    ['Drizzle', 'rain'],
    ['Chance Rain Showers', 'showers'],
    ['Slight Chance Rain Showers then Mostly Sunny', 'showers'],
    ['Chance Showers And Thunderstorms', 'thunder'],
    ['Slight Chance Rain Showers then Chance Showers And Thunderstorms', 'thunder'],
    ['Snow Likely', 'snow'],
    ['Rain And Snow', 'snow'],
    ['Freezing Rain', 'snow'],
    ['Chance Light Sleet', 'snow'],
  ] as const)('%s → %s', (text, kind) => {
    expect(conditionKind(text)).toBe(kind);
  });
});

describe('feelsLike', () => {
  const at = (temperature: number, humidity: number | null, windSpeed = '10 mph') => ({
    temperature,
    humidity,
    windSpeed,
    unit: 'F',
  });

  it('is the heat index from 80°F with the humidity known', () => {
    // NWS heat index chart: 90°F at 70% humidity is 106°F, 86°F at 75% is 97°F.
    expect(feelsLike(at(90, 70))).toBe(106);
    expect(Math.round(heatIndex(86, 75))).toBe(97);
    expect(feelsLike(at(84, null))).toBeNull();
    // Dry heat feels about the same: not shown.
    expect(feelsLike(at(80, 40))).toBeNull();
  });

  it('is the wind chill at 50°F or below with wind of 3 mph or more', () => {
    // NWS wind chill chart: 30°F with 15 mph wind is 19°F.
    expect(feelsLike(at(30, 60, '15 mph'))).toBe(19);
    expect(Math.round(windChill(0, 20))).toBe(-22);
    expect(feelsLike(at(30, 60, '0 mph'))).toBeNull();
    expect(feelsLike(at(30, 60, ''))).toBeNull();
  });

  it('is null in between, or for other units', () => {
    expect(feelsLike(at(70, 90))).toBeNull();
    expect(feelsLike({ ...at(90, 70), unit: 'C' })).toBeNull();
  });
});
