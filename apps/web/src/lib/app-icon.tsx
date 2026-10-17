import { motifSvg } from '@towncore/brand';
import type { Theme, TownConfig } from '@towncore/config';
import type { Town } from '@towncore/db';
import { ImageResponse } from 'next/og';
import { resolveTown } from './town';
import { themeFor } from './theme';

// Home Screen and app icons (docs/plans/M4b.md revision 5; CLAUDE.md §10b "derived assets"):
// the town's motif in its accent text color on its brand color, drawn in code. Square and
// full-bleed; iOS and Android round the corners themselves.

export const APP_ICON_SIZES = [180, 192, 512] as const;

/**
 * The motif icon drawn in code. `maskable` shrinks the motif into the safe zone Android keeps
 * when it crops an icon to a circle (the inner 80%).
 */
export function appIconResponse(theme: Theme, size: number, maskable = false): ImageResponse {
  const { accent, accentText } = theme.palette;
  const svg = motifSvg(theme.motif, 24).replace(/currentColor/g, accentText);
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: accent,
      }}
    >
      <img
        src={`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`}
        width={Math.round(size * (maskable ? 0.5 : 0.62))}
        height={Math.round(size * (maskable ? 0.5 : 0.62))}
        alt=""
      />
    </div>,
    {
      width: size,
      height: size,
      headers: { 'Cache-Control': 'public, max-age=86400' },
    },
  );
}

/** The town's ready-made icon folder (`app_icon` in its config), if it has one. */
export const townIconDir = (town: Pick<Town, 'config'>) =>
  (town.config as Pick<TownConfig, 'app_icon'>).app_icon?.replace(/\/$/, '');

/**
 * Route handler body for one icon size on the requesting town's domain: the town's own icon file
 * when it has one, else the motif icon drawn in code.
 */
export async function appIconRoute(
  host: string,
  size: number,
  maskable = false,
): Promise<Response> {
  const town = await resolveTown(host);
  if (!town) return new Response('Not found', { status: 404 });
  const dir = townIconDir(town);
  if (dir) {
    const file = maskable ? `icon-maskable-${size}.png` : `icon-${size}.png`;
    return new Response(null, {
      status: 307,
      headers: { Location: `${dir}/${file}`, 'Cache-Control': 'public, max-age=3600' },
    });
  }
  return appIconResponse(themeFor(town), size, maskable);
}

/**
 * The name under the icon on a Home Screen: the site's name when it fits (about 12 characters
 * show on a phone), else the town's own name, else what locals call it.
 */
export function homeScreenName(town: Pick<Town, 'siteName' | 'name' | 'config'>): string {
  if (town.siteName.length <= 12) return town.siteName;
  if (town.name.length <= 12) return town.name;
  return (town.config as Pick<TownConfig, 'short_name'>).short_name ?? town.name;
}

/** The web app manifest: installs as a standalone app opening on Today. */
export function webManifest(town: Town, theme: Theme) {
  return {
    id: '/',
    name: town.siteName,
    short_name: homeScreenName(town),
    description: `Local news for ${town.name}, ${town.state}, written from public records.`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    lang: 'en-US',
    categories: ['news'],
    background_color: theme.palette.background,
    theme_color: theme.palette.background,
    icons: [
      {
        src: `${townIconDir(town) ?? ''}/icon-192.png`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `${townIconDir(town) ?? ''}/icon-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        // The art inside Android's circle crop, so the town's picture is never clipped.
        src: `${townIconDir(town) ?? ''}/icon-maskable-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
