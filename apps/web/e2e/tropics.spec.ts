import { expect, test } from '@playwright/test';
import type { TropicsSnapshot, WeatherSnapshot } from '@towncore/config';
import { loadEnv } from '@towncore/config';
import {
  createDb,
  eq,
  saveTownWeather,
  saveTropics,
  towns,
  townWeather,
  tropics,
} from '@towncore/db';

// The tropics panel (config/tropics.ts): a Hurricane Center storm in the Atlantic shows as one
// line on the Today tile of a town that basin can reach, and in full on its Weather page.
// Seeded on the fictional Harbor Point (Maine, Atlantic basin) so Boca's weather is unaffected.
const harbor = 'http://harborpoint.test';

test.describe.serial('tropics', () => {
  const db = createDb(loadEnv().DATABASE_URL!, { max: 1 });
  let townId: string;

  test.beforeAll(async () => {
    const [town] = await db.select().from(towns).where(eq(towns.slug, 'harbor-point'));
    townId = town!.id;
    const now = new Date();
    const weather: WeatherSnapshot = {
      place: 'Harbor Point, ME',
      grid: { office: 'GYX', x: 1, y: 1 },
      updatedAt: now.toISOString(),
      now: {
        startTime: now.toISOString(),
        temperature: 64,
        shortForecast: 'Cloudy',
        precipChance: 20,
        windSpeed: '10 mph',
        windDirection: 'E',
        unit: 'F',
      },
      hours: [],
      today: { name: 'Today', high: 68, low: 55, shortForecast: 'Cloudy' },
      alerts: [],
      sourceUrl: 'https://forecast.weather.gov/MapClick.php?lat=44&lon=-69',
    };
    await saveTownWeather(db, townId, { snapshot: weather }, now);
    const snapshot: TropicsSnapshot = {
      basin: 'atlantic',
      storms: [
        {
          id: 'al142026',
          name: 'Ana',
          classification: 'HU',
          windKt: 80,
          pressureMb: 975,
          latitude: 27.4,
          longitude: -74.2,
          movement: { direction: 0, mph: 12 },
          advisory: {
            number: '9',
            issuedAt: now.toISOString(),
            url: 'https://www.nhc.noaa.gov/text/MIATCPAT4.shtml',
          },
          graphicsUrl: 'https://www.nhc.noaa.gov/graphics_at4.shtml',
        },
      ],
      outlook: {
        issuedAt: now.toISOString(),
        text: 'For the North Atlantic...Caribbean Sea and the Gulf of America:\n\nActive Systems: The National Hurricane Center is issuing advisories on Hurricane Ana.',
        areas: [],
        url: 'https://www.nhc.noaa.gov/gtwo.php?basin=atlc',
      },
    };
    await saveTropics(db, 'atlantic', { snapshot }, now);
  });

  test.afterAll(async () => {
    await db.delete(townWeather).where(eq(townWeather.townId, townId));
    await db.delete(tropics).where(eq(tropics.basin, 'atlantic'));
    await db.$client.end();
  });

  test('a line on the Today tile, the storm and outlook on the Weather page', async ({ page }) => {
    await page.goto(`${harbor}/`);
    const line = page.getByTestId('tropics-line');
    await expect(line).toHaveText('Tropics: Hurricane Ana, 90 mph winds');
    await line.getByRole('link').click();
    await expect(page).toHaveURL(/\/weather#tropics$/);
    const storms = page.getByTestId('storms');
    await expect(storms).toContainText('Hurricane Ana');
    await expect(storms).toContainText('Maximum sustained winds 90 mph, moving north at 12 mph');
    await expect(storms.getByRole('link', { name: 'Advisory 9' })).toHaveAttribute(
      'href',
      'https://www.nhc.noaa.gov/text/MIATCPAT4.shtml',
    );
    await expect(page.getByTestId('outlook')).toContainText('issuing advisories on Hurricane Ana');
    await expect(page.getByRole('link', { name: 'National Hurricane Center' })).toBeVisible();
  });
});
