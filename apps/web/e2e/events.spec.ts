import { expect, test } from '@playwright/test';
const boca = 'http://bocatownsquare.com';

// Events from the town's official calendars (owner's request, after bocatownsquare.com): event
// cards on the home page and the Events tab, one per event when calendars overlap, each with its
// own page and an "Add to calendar" file.

const SLUG = /\/events\/test-sample-nature-walk-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/;

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
  // Cards open the event's page on our site, which links the city's own page.
  await expect(walk).toHaveAttribute('href', SLUG);
  if (!isMobile) {
    await page.goto(`${boca}/`);
    const home = page
      .locator('[data-module="events"]')
      .getByTestId('event-card')
      .filter({ hasText: '[TEST]' });
    await expect(home).toHaveCount(2);
    await expect(home.filter({ hasText: 'Sample nature walk' })).toHaveAttribute('href', SLUG);
  }
});

// Every family (CLAUDE.md §14): coastal-modern, heritage and community, desktop and phone.
for (const [host, government] of [
  ['bocatownsquare.com', 'City of Boca Raton'],
  ['harborpoint.test', 'Town of Harbor Point'],
  ['pinehollow.test', 'Town of Pine Hollow'],
] as const) {
  test(`an event page on ${host}: when, where, the calendar's words and Add to calendar`, async ({
    page,
    request,
  }) => {
    await page.goto(`http://${host}/events`);
    await page.getByTestId('event-card').filter({ hasText: 'Sample nature walk' }).click();
    await expect(page).toHaveURL(SLUG);
    const detail = page.getByTestId('event-detail');
    await expect(detail.getByRole('heading', { level: 1 })).toHaveText('[TEST] Sample nature walk');
    // AP style in the town's time: "Tuesday, Oct. 20" then "6 to 7:30 p.m.".
    await expect(page.getByTestId('event-when')).toHaveText(
      /^[A-Z][a-z]+day, (Jan\.|Feb\.|March|April|May|June|July|Aug\.|Sept\.|Oct\.|Nov\.|Dec\.) \d{1,2}.*(a\.m\.|p\.m\.|noon|midnight)$/,
    );
    await expect(page.getByTestId('event-when')).not.toContainText(/AM|PM/);
    await expect(page.getByTestId('event-where')).toContainText('Sample Nature Center');
    await expect(page.getByTestId('event-where')).toContainText('100 Test Road');
    await expect(detail).toContainText('Bring water & a hat.');
    // The calendar's own link line isn't repeated as text; the page links the official listing.
    await expect(detail).not.toContainText('More info:');
    await expect(page.getByTestId('event-source')).toContainText(
      `From the ${government} calendar.`,
    );
    await expect(page.getByTestId('event-official-link')).toHaveAttribute(
      'href',
      /^https:\/\/example\.com\/test-event-[12]$/,
    );
    await expect(page.getByTestId('google-calendar')).toHaveAttribute(
      'href',
      /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/,
    );

    // Structured data, canonical, and noindex (a draft or fixture town is never listed).
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    const event = ld.map((t) => JSON.parse(t)).find((d) => d['@type'] === 'Event');
    expect(event).toMatchObject({
      name: '[TEST] Sample nature walk',
      location: { '@type': 'Place', name: 'Sample Nature Center' },
      organizer: { name: government },
    });
    expect(Date.parse(event.startDate)).not.toBeNaN();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', SLUG);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

    // The phone layout never scrolls sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // The calendar file.
    const href = await page.getByTestId('add-to-calendar').getAttribute('href');
    expect(href).toMatch(/\/ics$/);
    const ics = await request.get(`http://${host}${href}`);
    expect(ics.status()).toBe(200);
    expect(ics.headers()['content-type']).toContain('text/calendar');
    expect(ics.headers()['content-disposition']).toContain(
      'attachment; filename="test-sample-nature-walk.ics"',
    );
    const body = (await ics.text()).replace(/\r\n /g, '');
    expect(body).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(body).toMatch(/\r\nUID:event-[0-9a-f-]{36}@[a-z.]+\r\n/);
    expect(body).toMatch(/\r\nDTSTART:\d{8}T\d{6}Z\r\n/);
    expect(body).toMatch(/\r\nDTEND:\d{8}T\d{6}Z\r\n/);
    expect(body).toContain('SUMMARY:[TEST] Sample nature walk');
    expect(body).toContain('LOCATION:Sample Nature Center\\, 100 Test Road');
    expect(body).toContain('Bring water & a hat.');
  });
}

test('an unknown event is a 404, and a renamed one redirects to its address', async ({ page }) => {
  const missing = await page.goto(`${boca}/events/no-such-event-2026-01-01-00000000`);
  expect(missing?.status()).toBe(404);
  await page.goto(`${boca}/events`);
  const href = await page
    .getByTestId('event-card')
    .filter({ hasText: 'Sample nature walk' })
    .getAttribute('href');
  const old = href!.replace('test-sample-nature-walk', 'an-older-title');
  await page.goto(`${boca}${old}`);
  await expect(page).toHaveURL(SLUG);
});
