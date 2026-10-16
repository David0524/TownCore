import { expect, test } from '@playwright/test';
const boca = 'http://bocatownsquare.com';

// Events from the town's official calendars (owner's request, after bocatownsquare.com): event
// cards on the home page and the Events tab, one per event when calendars overlap.

test('the home page and the Events tab show calendar events as cards', async ({
  page,
  isMobile,
}) => {
  await page.goto(`${boca}/events`);
  const cards = page.getByTestId('event-card').filter({ hasText: '[TEST]' });
  await expect(cards).toHaveCount(2);
  const walk = cards.filter({ hasText: 'Sample nature walk' });
  await expect(walk).toContainText('Sample Nature Center, 100 Test Road');
  await expect(walk).not.toContainText('00000');
  await expect(walk).toHaveAttribute('href', 'https://example.com/test-event-1');
  if (!isMobile) {
    await page.goto(`${boca}/`);
    await expect(
      page
        .locator('[data-module="events"]')
        .getByTestId('event-card')
        .filter({ hasText: '[TEST]' }),
    ).toHaveCount(2);
  }
});
