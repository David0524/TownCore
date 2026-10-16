import { expect, test } from '@playwright/test';
import type { WeatherSnapshot } from '@towncore/config';
import { loadEnv } from '@towncore/config';
import { createDb, eq, saveTownWeather, towns, townWeather } from '@towncore/db';

// Beach tiles (D-M4b-3): rip current risk, water temperature, tides and UV, each with its source
// named. Seeded on the fictional Pine Hollow so Boca's own weather tests are unaffected.
const pine = 'http://pinehollow.test';

test.describe.serial('beach tiles', () => {
  const db = createDb(loadEnv().DATABASE_URL!, { max: 1 });
  let townId: string;

  test.beforeAll(async () => {
    const [town] = await db.select().from(towns).where(eq(towns.slug, 'pine-hollow'));
    townId = town!.id;
    const now = new Date();
    const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000).toISOString();
    const snapshot: WeatherSnapshot = {
      place: 'Pine Hollow, ME',
      grid: { office: 'GYX', x: 1, y: 1 },
      updatedAt: now.toISOString(),
      now: {
        startTime: now.toISOString(),
        temperature: 61,
        shortForecast: 'Partly sunny',
        precipChance: 10,
        windSpeed: '5 mph',
        windDirection: 'W',
        unit: 'F',
      },
      hours: [],
      today: { name: 'Today', high: 66, low: 48, shortForecast: 'Partly sunny' },
      alerts: [],
      sourceUrl: 'https://forecast.weather.gov/MapClick.php?lat=44&lon=-70',
      beach: {
        surf: {
          period: 'Rest of today',
          ripRisk: 'High',
          surfHeight: 'Around 3 feet',
          issuedAt: now.toISOString(),
          office: 'GYX',
          url: 'https://forecast.weather.gov/product.php?site=GYX&issuedby=GYX&product=SRF',
        },
        water: {
          fahrenheit: 58,
          at: now.toISOString(),
          station: '8418150',
          stationName: 'Portland, ME',
        },
        tides: {
          next: [
            { type: 'high', at: inHours(2) },
            { type: 'low', at: inHours(8) },
          ],
          station: '8418150',
          stationName: 'Portland, ME',
        },
        uv: { index: 4, zip: '04000', date: now.toISOString().slice(0, 10) },
      },
    };
    await saveTownWeather(db, townId, { snapshot }, now);
  });

  test.afterAll(async () => {
    await db.delete(townWeather).where(eq(townWeather.townId, townId));
    await db.$client.end();
  });

  test('shows each condition, with its sources on the Weather page', async ({ page }) => {
    await page.goto(`${pine}/`);
    const tiles = page.getByTestId('beach-tiles');
    await expect(tiles.getByTestId('beach-rip')).toContainText('High rip risk');
    await expect(tiles.getByTestId('beach-rip')).toHaveAttribute('title', 'Surf around 3 feet');
    await expect(tiles.getByTestId('beach-water')).toContainText('Water 58°');
    await expect(tiles.getByTestId('beach-tides')).toContainText('tide');
    await expect(tiles.getByTestId('beach-uv')).toContainText('UV 4');
    await expect(tiles.getByTestId('beach-uv')).toHaveAttribute('title', 'UV index 4: moderate');
    // No source links by the weather on the homepage (owner); they're on the Weather page.
    await expect(tiles.getByRole('link')).toHaveCount(0);
    await page.goto(`${pine}/weather`);
    const sources = page.getByTestId('beach-sources');
    await expect(sources.getByRole('link', { name: /surf forecast/ })).toBeVisible();
    await expect(
      sources.getByRole('link', { name: /NOAA Tides & Currents \(preliminary\)/ }),
    ).toBeVisible();
    await expect(sources.getByRole('link', { name: 'UV: U.S. EPA' })).toBeVisible();
  });
});
