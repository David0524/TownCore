import { expect, test } from '@playwright/test';

// Topic pages and related coverage (CLAUDE.md §6a; docs/plans/M4.md §4). Harbor Point's
// fixtures link four stories to the fictional "Sample Harbor Road".
const harbor = 'http://harborpoint.test';

test('a story links to the topics it names, and the topic lists its stories', async ({ page }) => {
  await page.goto(`${harbor}/news/test-site-plan`);
  const topics = page.getByTestId('story-topics');
  await topics.getByRole('link', { name: 'Sample Harbor Road' }).click();
  await expect(page).toHaveURL(`${harbor}/topics/sample-harbor-road`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sample Harbor Road');
  await expect(page.getByTestId('topic-kind')).toHaveText('Street');
  const stories = page.getByRole('main').locator('[data-story="brief"]');
  await expect(stories).toHaveCount(4);
  // Newest first.
  await expect(stories.first()).toContainText(
    'Fictional planning board reviews a sample site plan',
  );
  await expect(stories.nth(1)).toContainText('Select board sets a sample public hearing date');
});

test('related coverage lists stories that share topics', async ({ page }) => {
  await page.goto(`${harbor}/news/test-site-plan`);
  const related = page.getByTestId('related');
  await expect(related.getByRole('heading', { name: 'Related coverage' })).toBeVisible();
  await expect(related.locator('[data-story="list"]')).toHaveCount(3);
  await expect(related).not.toContainText('Three fictional businesses');
});

test('thin and unknown topics stay out of search', async ({ page }) => {
  // Harbor Point is a draft town and its stories are test fixtures: never indexed.
  await page.goto(`${harbor}/topics/sample-harbor-road`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  expect((await page.goto(`${harbor}/topics/no-such-topic`))?.status()).toBe(404);
});
