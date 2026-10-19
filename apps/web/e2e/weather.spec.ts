import { expect, test } from '@playwright/test';
import type { ForecastPeriod, WeatherPeriod, WeatherSnapshot } from '@towncore/config';
import { loadEnv } from '@towncore/config';
import { createDb, eq, saveTownWeather, towns } from '@towncore/db';

// The Weather page (owner, 2026-10-19: "in the shape of Kyle's"): every active alert, this hour's
// card, the 7-day list and the hourly row, from a seeded NWS snapshot. Boca (coastal-modern) has
// no alerts, so its amber bar stays off for the other specs; Feed Town (community, the live
// fixture town) has two, and shows the page is indexable and in the sitemap.
// The snapshots are left in place: the desktop and mobile projects run this file at once, and
// a fresh snapshot is harmless to the other specs.
const boca = 'http://bocatownsquare.com';
const feed = 'http://feedtown.test';

const HOUR = 3_600_000;

function snapshot(place: string, alerts: WeatherSnapshot['alerts']): WeatherSnapshot {
  const now = Date.now();
  const top = now - (now % HOUR);
  const iso = (t: number) => new Date(t).toISOString();
  const upcoming: WeatherPeriod[] = Array.from({ length: 36 }, (_, i) => ({
    startTime: iso(top + i * HOUR),
    temperature: 78 + (i % 6),
    shortForecast: i % 5 === 0 ? 'Chance Showers And Thunderstorms' : 'Partly Cloudy',
    precipChance: i % 5 === 0 ? 40 : 10,
    windSpeed: '12 mph',
    windDirection: 'NE',
    unit: 'F',
    humidity: 80,
    isDaytime: false,
  }));
  // Tonight, then six days with their nights: seven rows.
  const periods: ForecastPeriod[] = [
    {
      name: 'Tonight',
      startTime: iso(top - HOUR),
      endTime: iso(top + 10 * HOUR),
      isDaytime: false,
      temperature: 73,
      shortForecast: 'Partly Cloudy',
      detailedForecast: 'Partly cloudy, with a low around 73. Northeast wind around 12 mph.',
      precipChance: 11,
      windSpeed: '12 mph',
      windDirection: 'NE',
    },
    ...Array.from({ length: 12 }, (_, i): ForecastPeriod => {
      const start = top + 10 * HOUR + i * 12 * HOUR;
      const day = i % 2 === 0;
      const n = Math.floor(i / 2) + 1;
      return {
        name: day ? `Day ${n}` : `Day ${n} Night`,
        startTime: iso(start),
        endTime: iso(start + 12 * HOUR),
        isDaytime: day,
        temperature: day ? 84 : 72,
        shortForecast: n === 1 ? 'Chance Showers And Thunderstorms' : 'Sunny',
        detailedForecast: day ? `Day ${n} text from NWS.` : `Night ${n} text from NWS.`,
        precipChance: n === 1 ? 40 : null,
        windSpeed: '10 mph',
        windDirection: 'E',
      };
    }),
  ];
  return {
    place,
    grid: { office: 'MFL', x: 1, y: 1 },
    updatedAt: iso(now),
    now: upcoming[0]!,
    hours: [],
    upcoming,
    today: { name: 'Tonight', high: null, low: 72, shortForecast: 'Partly Cloudy' },
    alerts,
    sourceUrl: 'https://forecast.weather.gov/MapClick.php?lat=26.3587&lon=-80.0831',
    days: { updatedAt: iso(now), fetchedAt: iso(now), periods },
  };
}

test.describe('weather page', () => {
  test.beforeAll(async () => {
    const db = createDb(loadEnv().DATABASE_URL!, { max: 1 });
    try {
      const until = new Date(Date.now() + 30 * HOUR).toISOString();
      for (const [slug, alerts] of [
        ['boca-raton', []],
        [
          'feed-town',
          [
            {
              id: 'urn:test:rip',
              event: 'Rip Current Statement',
              headline: 'Rip Current Statement issued by NWS Miami FL',
              severity: 'Moderate',
              until,
              url: 'https://alerts.weather.gov/test-rip',
            },
            {
              id: 'urn:test:surf',
              event: 'High Surf Warning',
              headline: 'High Surf Warning issued by NWS Miami FL',
              severity: 'Severe',
              until,
              url: 'https://alerts.weather.gov/test-surf',
            },
          ],
        ],
      ] as const) {
        const [town] = await db.select().from(towns).where(eq(towns.slug, slug));
        await saveTownWeather(db, town!.id, { snapshot: snapshot(town!.name, [...alerts]) });
      }
    } finally {
      await db.$client.end();
    }
  });

  test('Boca: this hour, seven days from Tonight, the hours, no alerts', async ({ page }) => {
    await page.goto(`${boca}/weather`);
    await expect(page).toHaveTitle(/^Boca Raton weather: forecast and alerts/);
    const card = page.getByTestId('current-conditions');
    await expect(card).toContainText('This hour in Boca Raton');
    await expect(card).toContainText('Chance showers and thunderstorms');
    // 78°F at 80% humidity is under 80°F: no heat index; the wind is named.
    await expect(card).toContainText('Wind NE 12 mph');
    await expect(card.locator('svg[data-kind="thunder"]')).toHaveCount(1);

    const days = page.getByTestId('forecast-day');
    await expect(days).toHaveCount(7);
    await expect(days.first()).toContainText('Tonight');
    await expect(days.first()).toContainText('73°');
    await expect(days.nth(1)).toContainText('Day 1');
    await expect(days.nth(1)).toContainText('40% rain');
    await expect(days.nth(1)).toContainText('84°');
    await expect(days.nth(1).locator('svg[data-kind="thunder"]')).toHaveCount(1);
    await expect(days.nth(2).locator('svg[data-kind="clear"]')).toHaveCount(1);
    // A row opens to NWS's own words.
    await expect(days.nth(1).getByText('Day 1 text from NWS.')).toBeHidden();
    await days.nth(1).locator('summary').click();
    await expect(days.nth(1).getByText('Day 1 text from NWS.')).toBeVisible();
    await expect(days.nth(1).getByText('Night 1 text from NWS.')).toBeVisible();

    await expect(page.getByTestId('hourly-row').locator('li')).toHaveCount(12);
    await expect(page.getByTestId('alert-list')).toHaveCount(0);
    await expect(page.getByTestId('no-alerts')).toHaveText(
      'No active weather alerts for Boca Raton.',
    );
    await expect(page.getByTestId('weather-credit')).toContainText(
      'Forecast: National Weather Service, updated',
    );
    await expect(page.getByText('In an emergency, follow guidance')).toBeVisible();
    // NWS icon images are never shown (Rule 9).
    await expect(page.locator('img[src*="weather.gov"]')).toHaveCount(0);
    // Nothing wider than the page on phones.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('Feed Town: every alert, most severe first, and an indexable page', async ({ page }) => {
    await page.goto(`${feed}/weather`);
    const alerts = page.getByTestId('alert-list').locator('li');
    await expect(alerts).toHaveCount(2);
    await expect(alerts.first()).toContainText('High Surf Warning');
    await expect(alerts.first()).toContainText('until');
    await expect(alerts.first()).toContainText('issued by NWS Miami FL');
    await expect(
      alerts.nth(1).getByRole('link', { name: 'Rip Current Statement' }),
    ).toHaveAttribute('href', 'https://alerts.weather.gov/test-rip');
    await expect(page.getByTestId('no-alerts')).toHaveCount(0);
    await expect(page.getByTestId('current-conditions')).toBeVisible();
    await expect(page.getByTestId('forecast-day')).toHaveCount(7);
    // A real forecast: listed in search (Feed Town is live), with a description.
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      /National Weather Service forecast for Feed Town/,
    );
    const pages = await (await page.goto(`${feed}/sitemaps/pages.xml`))!.text();
    expect(pages).toContain('<loc>https://feedtown.test/weather</loc>');
  });
});
