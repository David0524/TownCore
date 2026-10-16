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
): Promise<Shot[]> {
  mkdirSync(outDir, { recursive: true });
  const browser = await launch(target);
  const shots: Shot[] = [];
  try {
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
    fontFamily: 'var(--font-headline)',
    fontWeight: set.headlineWeight,
    advanceEm: set.headlineAdvanceEm,
  };
  const browser = await launch(target);
  const shots: Shot[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1700, height: 700 } });
    await page.goto(`http://${target.domain}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
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
