import { expect, test } from '@playwright/test';

// Default images (docs/plans/default-images.md; owner, 2026-10-17): a story whose only visual is
// the title card is never the cover story. Each town's newest story is an approved public-safety
// notice on its title card; it ranks high but never takes a lead slot, on the homepage, the
// phone's top-stories row or a section front.

const towns = {
  boca: 'http://bocatownsquare.com',
  harbor: 'http://harborpoint.test',
  pine: 'http://pinehollow.test',
};

for (const [name, url] of Object.entries(towns)) {
  test(`${name}: the homepage lead has a picture, never the title card`, async ({ page }) => {
    await page.goto(`${url}/`);
    const lead = page.locator('[data-module="lead-story"]');
    // Pine Hollow's front is briefing-led: no lead module at all.
    if ((await lead.count()) === 0) return;
    await expect(lead.locator('[data-visual="typographic-card"]')).toHaveCount(0);
    await expect(lead.locator('h2 a').first()).not.toHaveAttribute('href', /test-safety-notice/);
    await expect(lead.locator('img, [data-visual]').first()).toBeAttached();
  });

  test(`${name}: a section front leads with a picture, or with no lead at all`, async ({
    page,
  }) => {
    await page.goto(`${url}/beat/public-safety`);
    // Its only story is on the title card, so it's listed as a brief, not as the lead.
    const main = page.getByRole('main');
    await expect(main.locator('[data-visual="typographic-card"]')).toHaveCount(0);
    await expect(main.getByRole('link', { name: /Sample police notice/ })).toBeVisible();
    await page.goto(`${url}/beat/government`);
    await expect(page.getByRole('main').locator('[data-visual="typographic-card"]')).toHaveCount(0);
  });
}

test('phones: the first card of More top stories has a picture', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the row is phone-only');
  await page.goto(`${towns.harbor}/`);
  const first = page.getByTestId('top-stories-row').getByRole('listitem').first();
  await expect(first.locator('[data-visual="thumb"]')).toHaveCount(0);
});
