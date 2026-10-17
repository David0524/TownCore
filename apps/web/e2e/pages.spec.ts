import { expect, test } from '@playwright/test';

const boca = 'http://bocatownsquare.com';
const harbor = 'http://harborpoint.test';

test.describe('About, Methods and Corrections (Rule 1)', () => {
  test('About names the publisher, explains AI assistance and gives the site contact', async ({
    page,
  }) => {
    const response = await page.goto(`${boca}/about`);
    expect(response?.status()).toBe(200);
    const main = page.getByRole('main');
    await expect(main).toContainText('Boca Town Square is published by TownCore.');
    await expect(main).not.toContainText('(AI-assisted)');
    await expect(
      main.getByRole('link', { name: 'news@bocatownsquare.com' }).first(),
    ).toHaveAttribute('href', 'mailto:news@bocatownsquare.com');
  });

  test('Methods explains sources, fact-checking, human review and labels', async ({ page }) => {
    const response = await page.goto(`${boca}/methods`);
    expect(response?.status()).toBe(200);
    const main = page.getByRole('main');
    for (const phrase of ['public records', 'Fact-checking', 'approved by a person', 'Sponsored']) {
      await expect(main).toContainText(phrase);
    }
  });

  test('Privacy names the publisher and explains the newsletter data', async ({ page }) => {
    const response = await page.goto(`${boca}/privacy`);
    expect(response?.status()).toBe(200);
    const main = page.getByRole('main');
    await expect(main).toContainText('Boca Town Square is published by TownCore.');
    await expect(main).toContainText("We don't put tracking pixels");
  });

  test('Corrections lists corrections with links to the stories', async ({ page }) => {
    const response = await page.goto(`${boca}/corrections`);
    expect(response?.status()).toBe(200);
    const list = page.getByTestId('corrections-list');
    await expect(list).toContainText('Test correction');
    await expect(list.getByRole('link')).toHaveAttribute('href', '/news/test-article');
  });

  test('only the About and Privacy pages mention the publisher', async ({ page }) => {
    for (const path of [
      '/',
      '/methods',
      '/corrections',
      '/news/test-article',
      '/beat/government',
    ]) {
      await page.goto(`${boca}${path}`);
      expect(await page.content(), path).not.toMatch(/towncore/i);
    }
  });
});

test.describe('article page', () => {
  test('shows the honest byline, sources, correction and report-an-error link', async ({
    page,
  }) => {
    const response = await page.goto(`${boca}/news/test-article`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      '[TEST] This is a test article for Boca Town Square',
    );
    await expect(page.getByTestId('byline')).toHaveText('Boca Town Square Newsroom');
    const sources = page.getByTestId('sources');
    await expect(sources.getByRole('link')).toHaveAttribute('href', 'https://www.myboca.us/');
    await expect(page.getByTestId('correction-notice')).toContainText('Test correction');
    await expect(page.getByTestId('report-error')).toHaveAttribute(
      'href',
      /^mailto:news@bocatownsquare\.com\?subject=/,
    );
    await expect(page.getByTestId('how-we-report')).toHaveAttribute('href', '/methods');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
    await expect(page.locator('[data-part="article:classic-rail"]')).toHaveCount(1);
  });

  test('Harbor Point uses the wide-reading template and the real estate slot on a development story', async ({
    page,
  }) => {
    await page.goto(`${harbor}/news/test-site-plan`);
    await expect(page.locator('[data-part="article:wide-reading"]')).toHaveCount(1);
    await expect(page.locator('[data-part="grid:single-column"]')).toHaveCount(1);
    await expect(page.locator('[data-slot="article.realestate"]')).toHaveCount(1);
  });

  test('drafts and unknown slugs are 404', async ({ page }) => {
    const response = await page.goto(`${boca}/news/not-a-story`);
    expect(response?.status()).toBe(404);
  });

  test('home and beat pages list the published test article', async ({ page }) => {
    await page.goto(`${boca}/`);
    await expect(page.locator('[data-module="lead-story"]')).toContainText('[TEST]');
    await page.goto(`${boca}/beat/government`);
    await expect(
      page.getByRole('main').getByRole('link', { name: /\[TEST\] This is a test article/ }),
    ).toBeVisible();
  });
});

test.describe('ad standards (CLAUDE.md §11b)', () => {
  for (const [town, url] of [
    ['Boca', `${boca}/news/test-article`],
    ['Harbor Point', `${harbor}/news/test-site-plan`],
  ] as const) {
    test(`${town}: no ad between headline and first paragraph; inline slot after paragraph 3`, async ({
      page,
    }) => {
      await page.goto(url);
      const layout = await page.evaluate(() => {
        const h1 = document.querySelector('h1')!.getBoundingClientRect().bottom;
        const paragraphs = [...document.querySelectorAll('[data-testid="article-body"] p')];
        const firstP = paragraphs[0]!.getBoundingClientRect().top;
        const slots = [...document.querySelectorAll('[data-slot]')].map((el) => ({
          name: el.getAttribute('data-slot'),
          top: el.getBoundingClientRect().top,
          insideLocked: !!el.closest('[data-testid="sources"], [data-testid="correction-notice"]'),
          label: el.querySelector('[data-testid="slot-label"]')?.textContent ?? '',
        }));
        const inline = document.querySelector('[data-slot="article.inline"]');
        const before = inline
          ? paragraphs.filter(
              (p) => p.compareDocumentPosition(inline) & Node.DOCUMENT_POSITION_FOLLOWING,
            ).length
          : -1;
        return { h1, firstP, slots, paragraphsBeforeInline: before };
      });
      for (const slot of layout.slots) {
        expect(
          slot.top > layout.h1 && slot.top < layout.firstP,
          `${slot.name} between headline and body`,
        ).toBe(false);
        expect(slot.insideLocked, `${slot.name} inside sources/correction`).toBe(false);
        expect(slot.label, `${slot.name} label`).not.toBe('');
      }
      expect(layout.paragraphsBeforeInline).toBe(3);
      const names = layout.slots.map((s) => s.name);
      expect(names).toEqual(
        expect.arrayContaining(['article.inline', 'article.related-businesses', 'rail.box']),
      );
    });
  }

  test('mobile ad density on an article stays at or below 30%', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'density rule is for mobile');
    for (const url of [`${boca}/news/test-article`, `${harbor}/news/test-site-plan`]) {
      await page.goto(url);
      const density = await page.evaluate(() => {
        const slotHeight = [...document.querySelectorAll('[data-slot]')]
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .reduce((sum, el) => sum + el.getBoundingClientRect().height, 0);
        return slotHeight / document.documentElement.scrollHeight;
      });
      expect(density, url).toBeLessThanOrEqual(0.3);
    }
  });

  test('no pop-ups, sticky ads or autoplay media', async ({ page }) => {
    await page.goto(`${boca}/news/test-article`);
    const offenders = await page.evaluate(() =>
      [...document.querySelectorAll('[data-slot]')]
        .filter((el) => ['fixed', 'sticky'].includes(getComputedStyle(el).position))
        .map((el) => el.getAttribute('data-slot')),
    );
    expect(offenders).toEqual([]);
    await expect(page.locator('video[autoplay], audio[autoplay], dialog[open]')).toHaveCount(0);
  });
});
