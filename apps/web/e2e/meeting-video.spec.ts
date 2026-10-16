import { expect, test } from '@playwright/test';

// Meeting videos on recaps (owner's decision, 2026-10-16): click to play, nothing from YouTube
// before the click (no thumbnail, Rule 9; no third-party request, D-M4-3), a reserved 16:9 box.
const boca = 'http://bocatownsquare.com';

test('a recap shows its meeting video as a click-to-play player', async ({ page }) => {
  const youtube: string[] = [];
  await page.route(/youtube(-nocookie)?\.com|ytimg\.com|googlevideo\.com/, (route) => {
    youtube.push(route.request().url());
    // CI never calls YouTube: answer the player request with a stand-in page.
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>player</p>' });
  });
  await page.goto(`${boca}/news/test-meeting-recap`);
  const section = page.getByTestId('meeting-video');
  await expect(section.getByRole('heading', { name: 'Watch the meeting' })).toBeVisible();
  const play = section.getByTestId('meeting-video-play');
  await expect(play).toContainText('City Commission Regular Meeting (test video)');
  await expect(section.getByTestId('meeting-video-credit')).toContainText(
    'Video: Sample city channel (test), on YouTube',
  );
  await expect(section.getByRole('link', { name: 'YouTube' })).toHaveAttribute(
    'href',
    'https://www.youtube.com/watch?v=testVideo01',
  );
  // Nothing from YouTube yet, and no image of theirs on the page.
  expect(youtube).toEqual([]);
  await expect(section.locator('img')).toHaveCount(0);
  await expect(section.locator('iframe')).toHaveCount(0);
  const before = await play.boundingBox();
  expect(Math.round((before!.width / before!.height) * 9)).toBe(16);

  await play.click();
  const player = section.getByTestId('meeting-video-player');
  await expect(player).toHaveAttribute(
    'src',
    'https://www.youtube-nocookie.com/embed/testVideo01?autoplay=1&rel=0',
  );
  await expect(player).toHaveAttribute('title', 'City Commission Regular Meeting (test video)');
  // Same box, so nothing shifts.
  const after = await player.boundingBox();
  expect(Math.abs(after!.height - before!.height)).toBeLessThan(2);
  await expect
    .poll(() => youtube.some((u) => u.startsWith('https://www.youtube-nocookie.com/')))
    .toBe(true);
});

test('stories that are not about a meeting show no video', async ({ page }) => {
  await page.goto(`${boca}/news/test-article`);
  await expect(page.getByTestId('article-body')).toBeVisible();
  await expect(page.getByTestId('meeting-video')).toHaveCount(0);
});
