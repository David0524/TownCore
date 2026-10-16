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

export function appIconResponse(theme: Theme, size: number): ImageResponse {
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
        width={Math.round(size * 0.62)}
        height={Math.round(size * 0.62)}
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
export async function appIconRoute(host: string, size: number): Promise<Response> {
  const town = await resolveTown(host);
  if (!town) return new Response('Not found', { status: 404 });
  const dir = townIconDir(town);
  if (dir) {
    return new Response(null, {
      status: 307,
      headers: { Location: `${dir}/icon-${size}.png`, 'Cache-Control': 'public, max-age=3600' },
    });
  }
  return appIconResponse(themeFor(town), size);
}

/** The web app manifest: installs as a standalone app opening on Today. */
export function webManifest(town: Town, theme: Theme) {
  return {
    name: town.siteName,
    short_name: town.siteName.length <= 12 ? town.siteName : town.name,
    description: `Local news for ${town.name}, ${town.state}, written from public records.`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
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
        src: `${townIconDir(town) ?? ''}/icon-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
