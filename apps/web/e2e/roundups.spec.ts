import { expect, test } from '@playwright/test';

// Roundups that read like articles, and sources that don't swamp the page (owner, 2026-10-17).
// The fixture roundup in each town is built by the real template from 40 fictional filings.

const towns = [
  ['Boca Raton', 'http://bocatownsquare.com'],
  ['Harbor Point', 'http://harborpoint.test'],
  ['Pine Hollow', 'http://pinehollow.test'],
] as const;

for (const [name, url] of towns) {
  test(`${name}: the roundup leads with prose and highlights, then a compact table`, async ({
    page,
  }) => {
    await page.goto(`${url}/news/test-filings-roundup`);
    const body = page.getByTestId('article-body');
    const lede = body.locator('p').first();
    const highlights = body.getByRole('heading', { name: 'What stands out' });
    const table = body.locator('.data-table').first();
    await expect(lede).toContainText("That's up from 31 the week before");
    await expect(highlights).toBeVisible();
    // Lede and highlights come before any table, on phones and desktop.
    const y = async (l: typeof lede) => (await l.boundingBox())!.y;
    expect(await y(lede)).toBeLessThan(await y(highlights));
    expect(await y(highlights)).toBeLessThan(await y(table));
    // Twelve rows show; the rest wait behind a closed "Show all".
    await expect(table.locator('tbody tr')).toHaveCount(12);
    const more = body.locator('details.data-more');
    await expect(more).not.toHaveAttribute('open', /.*/);
    await expect(more.locator('summary')).toHaveText('Show all 40 filings');
    await more.locator('summary').click();
    await expect(more.locator('tbody tr')).toHaveCount(28);
    // Tables scroll inside their own box: never the page sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test(`${name}: sources fit in one screen before "Show all", and every record stays in the page`, async ({
    page,
  }) => {
    await page.goto(`${url}/news/test-filings-roundup`);
    const sources = page.getByTestId('sources');
    await expect(sources.getByTestId('source-group')).toHaveCount(1);
    await expect(sources.getByTestId('source-group')).toContainText(
      /new business filings, .+ \(40 records\)/,
    );
    await expect(sources.getByTestId('source-group')).toContainText('About this data:');
    const all = sources.getByTestId('all-sources');
    await expect(all).not.toHaveAttribute('open', /.*/);
    await expect(all.locator('summary')).toHaveText('Show all 40 records');
    // Everything above "Show all" fits in one screen.
    const viewport = page.viewportSize()!;
    const box = (await sources.boundingBox())!;
    const summary = (await all.locator('summary').boundingBox())!;
    expect(summary.y + summary.height - box.y).toBeLessThan(viewport.height);
    // Rule 4: every record's link is in the page HTML and in the structured data.
    const html = await page.content();
    for (let day = 0; day < 7; day++) expect(html).toContain(`-filings/day-${day}"`);
    await expect(all.locator('ol > li')).toHaveCount(40);
    await expect(all.locator('ol a[href^="https://example.com/"]')).toHaveCount(40);
    const citations = await page.evaluate(() =>
      [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((s) => JSON.parse(s.textContent ?? '{}') as { citation?: unknown[] })
        .flatMap((j) => j.citation ?? []),
    );
    expect(citations).toHaveLength(40);
  });
}

test('a story with one record links that record directly, with no "Show all"', async ({ page }) => {
  await page.goto('http://harborpoint.test/news/test-site-plan');
  const sources = page.getByTestId('sources');
  await expect(sources.getByTestId('source-group')).toHaveCount(1);
  await expect(
    sources.getByRole('link', { name: 'Sample agenda (fictional test source)' }),
  ).toHaveAttribute('href', 'https://example.com/harbor-point-agenda');
  await expect(sources.getByTestId('all-sources')).toHaveCount(0);
});
