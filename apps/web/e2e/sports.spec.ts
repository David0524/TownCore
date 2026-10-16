import { expect, test } from '@playwright/test';

// The Sports tab (owner, 2026-10-16; docs/plans/sports.md) on the fictional Harbor Point, whose
// fixture games are a final from two days ago and two games ahead. Team level only.
const harbor = 'http://harborpoint.test';
const boca = 'http://bocatownsquare.com';

test('the Sports page lists coming games and recent finals by day', async ({ page }) => {
  await page.goto(`${harbor}/sports`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Sports', level: 1 })).toBeVisible();
  const upcoming = page.getByTestId('sports-upcoming');
  await expect(upcoming.getByTestId('event-card')).toHaveCount(2);
  await expect(upcoming).toContainText('Harbor Point at Cape Lantern');
  await expect(upcoming).toContainText('Girls Volleyball');
  const results = page.getByTestId('sports-results');
  await expect(results).toContainText('Harbor Point 21, Gull Rock 14');
  await expect(results).toContainText('Football · Final');
  // Filtering by sport.
  await page.getByTestId('sport-chips').getByRole('link', { name: 'Girls Volleyball' }).click();
  await expect(page.getByTestId('sports-upcoming').getByTestId('event-card')).toHaveCount(1);
  await expect(page.getByTestId('sports-results')).toHaveCount(0);
});

test('the homepage shows next games and the Sections tab links Sports', async ({ page }) => {
  await page.goto(harbor);
  const module = page.locator('[data-module="schools-sports"]');
  await expect(module.getByRole('heading', { name: 'Next games' })).toBeVisible();
  await expect(module.getByTestId('event-card')).toHaveCount(2);
  await page.goto(`${harbor}/sections`);
  await expect(page.getByRole('link', { name: /Sports/ })).toHaveAttribute('href', '/sports');
});

test('a town with no games says so and shows no Sports section', async ({ page }) => {
  await page.goto(`${boca}/sports`);
  await expect(page.getByTestId('sports-empty')).toBeVisible();
  await page.goto(`${boca}/sections`);
  await expect(page.getByRole('link', { name: /^Sports/ })).toHaveCount(0);
});
