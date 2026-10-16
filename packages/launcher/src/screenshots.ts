import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mastheadSvg, siteAssets, siteAssetSvg, type SiteAsset } from '@towncore/brand';
import { typePairings, type Theme } from '@towncore/config';
import { chromium, type Browser } from 'playwright-core';

// Screenshots for the launch report (CLAUDE.md §11a, theme generation step 4): the draft town's
// pages on a phone and a desktop, its three masthead options and its identity assets, rendered by
// the running web app (which serves draft towns, noindex) with the town's own fonts. The browser
// maps the town's domain to the app, so nothing leaves this machine.

export type ShotTarget = {
  /** The running web app, e.g. http://localhost:3000. */
  siteUrl: string;
  /** The draft town's domain, mapped to siteUrl. */
  domain: string;
  /** Chromium binary (defaults to Playwright's own). */
  executablePath?: string;
};

export const viewports = {
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
} as const;

export type Shot = { name: string; path: string; viewport: keyof typeof viewports | 'asset' };

/** The web app caches a town for 60 seconds; wait (up to this long) for it to show the theme. */
const THEME_WAIT_MS = 90_000;

/** Reloads the home page until it renders `theme` (its family and brand color), or throws. */
async function waitForTheme(
  page: import('playwright-core').Page,
  url: string,
  theme: Pick<Theme, 'family' | 'palette'>,
  sleep: (ms: number) => Promise<void>,
) {
  const deadline = Date.now() + THEME_WAIT_MS;
  for (;;) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const shown = await page.evaluate(() => {
      const el = document.querySelector('[data-family]');
      return {
        family: el?.getAttribute('data-family') ?? null,
        accent: el ? getComputedStyle(el).getPropertyValue('--accent').trim() : '',
      };
    });
    if (
      shown.family === theme.family &&
      shown.accent.toUpperCase() === theme.palette.accent.toUpperCase()
    )
      return;
    if (Date.now() > deadline)
      throw new Error(
        `The site still shows ${shown.family ?? 'no'} theme (${shown.accent}), not the new one.`,
      );
    await sleep(5_000);
  }
}

async function launch(target: ShotTarget): Promise<Browser> {
  const app = new URL(target.siteUrl);
  return chromium.launch({
    ...(target.executablePath ? { executablePath: target.executablePath } : {}),
    args: [`--host-resolver-rules=MAP ${target.domain} ${app.hostname}:${app.port || 80}`],
  });
}

/** Home, an article and the directory on a phone and a desktop. */
export async function capturePages(
  target: ShotTarget,
  outDir: string,
  pages: Array<{ name: string; path: string }>,
  theme: Pick<Theme, 'family' | 'palette'>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<Shot[]> {
  mkdirSync(outDir, { recursive: true });
  const browser = await launch(target);
  const shots: Shot[] = [];
  try {
    await waitForTheme(await browser.newPage(), `http://${target.domain}/`, theme, sleep);
    for (const [viewport, settings] of Object.entries(viewports) as Array<
      [keyof typeof viewports, (typeof viewports)[keyof typeof viewports]]
    >) {
      const context = await browser.newContext({
        viewport: { width: settings.width, height: settings.height },
        deviceScaleFactor: settings.deviceScaleFactor,
        isMobile: settings.isMobile,
        hasTouch: settings.hasTouch,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      for (const p of pages) {
        const response = await page.goto(`http://${target.domain}${p.path}`, {
          waitUntil: 'networkidle',
        });
        if (!response?.ok())
          throw new Error(`${p.path} answered HTTP ${response?.status() ?? 'nothing'}`);
        await page.evaluate(() => document.fonts.ready);
        const path = join(outDir, `${p.name}-${viewport}.png`);
        await page.screenshot({ path, fullPage: false });
        shots.push({ name: p.name, path, viewport });
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return shots;
}

/**
 * The three masthead options and the site's identity assets (§10b), drawn as SVG and rendered on
 * the town's home page so its fonts are loaded (the SVGs use var(--font-headline)).
 */
export async function captureIdentity(
  target: ShotTarget,
  outDir: string,
  input: { siteName: string; place: string; theme: Theme; mastheads: Theme['masthead'][] },
): Promise<Shot[]> {
  mkdirSync(outDir, { recursive: true });
  const set = typePairings[input.theme.type];
  const font = {
    fontFamily: 'serif',
    fontWeight: set.headlineWeight,
    advanceEm: set.headlineAdvanceEm,
  };
  const browser = await launch(target);
  const shots: Shot[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1700, height: 700 } });
    await page.goto(`http://${target.domain}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    // The town's headline face as the page resolves it; the SVGs name it directly, since the
    // element that defines --font-headline is replaced when each asset is drawn.
    font.fontFamily = await page.evaluate(() => {
      const heading = document.querySelector('h1, h2, h3');
      return heading ? getComputedStyle(heading).fontFamily : 'serif';
    });
    const render = async (name: string, svg: string, width: number, height: number) => {
      writeFileSync(join(outDir, `${name}.svg`), svg);
      await page.evaluate(
        ({ svg, width, height }) => {
          document.body.innerHTML = `<div id="shot" style="width:${width}px;height:${height}px;background:#fff;color:#111">${svg}</div>`;
          document.body.style.margin = '0';
        },
        { svg, width, height },
      );
      await page.evaluate(() => document.fonts.ready);
      const path = join(outDir, `${name}.png`);
      await page.locator('#shot').screenshot({ path });
      shots.push({ name, path, viewport: 'asset' });
    };
    for (const style of input.mastheads) {
      const svg = mastheadSvg({
        siteName: input.siteName,
        style,
        motif: input.theme.motif,
        ...font,
      }).replace('<svg ', `<svg style="width:100%;height:100%;color:${input.theme.palette.ink}" `);
      await render(`masthead-${style}`, svg, 720, 180);
    }
    for (const kind of Object.keys(siteAssets) as SiteAsset[]) {
      const { width, height } = siteAssets[kind];
      await render(
        kind,
        siteAssetSvg(kind, {
          siteName: input.siteName,
          place: input.place,
          masthead: input.theme.masthead,
          motif: input.theme.motif,
          palette: input.theme.palette,
          ...font,
        }),
        width,
        height,
      );
    }
  } finally {
    await browser.close();
  }
  return shots;
}
