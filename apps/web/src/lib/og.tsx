import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { motifSvg } from '@towncore/brand';
import { beatCategory, beats, categoryColors, typePairings, type Theme } from '@towncore/config';
import type { Article, Town } from '@towncore/db';
import type { ImageChoice } from '@towncore/pipeline';
import { ImageResponse } from 'next/og';

// Open Graph images (CLAUDE.md §11c; docs/plans/M4.md §3): one per article at 1200×630, made
// from the article's visual plus its headline in the town's theme. Drawn in code from our own
// text and records; nothing is fetched from other sites.

export const OG_SIZE = { width: 1200, height: 630 } as const;

// The renderer reads woff/ttf, not woff2, so display faces come from Fontsource's static
// packages (self-hosted, never fetched from Google). A face without a static file falls back to
// the renderer's built-in sans.
const DISPLAY_FONTS: Record<string, { file: string; weight: 400 | 700 | 800 }> = {
  'Instrument Serif': {
    file: '@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff',
    weight: 400,
  },
  'Libre Caslon Display': {
    file: '@fontsource/libre-caslon-display/files/libre-caslon-display-latin-400-normal.woff',
    weight: 400,
  },
  'Bricolage Grotesque Variable': {
    file: '@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff',
    weight: 800,
  },
  'Libre Caslon Text': {
    file: '@fontsource/libre-caslon-text/files/libre-caslon-text-latin-700-normal.woff',
    weight: 700,
  },
  Spectral: { file: '@fontsource/spectral/files/spectral-latin-700-normal.woff', weight: 700 },
};

const fontCache = new Map<string, Promise<ArrayBuffer | null>>();

async function displayFont(name: string) {
  const entry = DISPLAY_FONTS[name];
  if (!entry) return null;
  if (!fontCache.has(entry.file)) {
    fontCache.set(
      entry.file,
      readFile(join(process.cwd(), 'node_modules', entry.file))
        .then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
        .catch(() => null),
    );
  }
  const data = await fontCache.get(entry.file)!;
  return data ? { name: 'Display', data, weight: entry.weight, style: 'normal' as const } : null;
}

const headlineSize = (text: string, narrow: boolean) => {
  const n = text.length * (narrow ? 1.5 : 1);
  return n <= 60 ? 76 : n <= 100 ? 62 : n <= 150 ? 52 : 44;
};

export async function articleOgImage({
  town,
  theme,
  article,
  image,
}: {
  town: Pick<Town, 'siteName' | 'domain'>;
  theme: Theme;
  article: Pick<Article, 'headline' | 'beat'>;
  image: ImageChoice;
}): Promise<ImageResponse> {
  const { palette } = theme;
  const font = await displayFont(typePairings[theme.type].headline);
  const chart =
    image.kind === 'data-graphic' && image.spec.type === 'daily-counts' ? image.spec : null;
  const beatLabel = beats.find((b) => b.slug === article.beat)?.label ?? 'News';
  const dot = categoryColors[beatCategory[article.beat] ?? 'news'];
  const motif = `data:image/svg+xml;base64,${Buffer.from(
    motifSvg(theme.motif, 24).replace(/currentColor/g, palette.background),
  ).toString('base64')}`;
  const max = chart ? Math.max(...chart.bars.map((b) => b.count), 1) : 1;
  const display = font ? 'Display' : undefined;

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 64,
        background: palette.ink,
        color: palette.background,
        position: 'relative',
      }}
    >
      {chart ? null : (
        <img
          src={motif}
          width={440}
          height={440}
          alt=""
          style={{ position: 'absolute', right: -40, bottom: -70, opacity: 0.14 }}
        />
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: display, fontSize: 36 }}>{town.siteName}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 26 }}>
          <span style={{ width: 16, height: 16, borderRadius: 8, background: dot }} />
          {beatLabel}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 48 }}>
        <div
          style={{
            display: 'flex',
            flex: 1,
            fontFamily: display,
            fontSize: headlineSize(article.headline, Boolean(chart)),
            lineHeight: 1.05,
            letterSpacing: -1,
          }}
        >
          {article.headline}
        </div>
        {chart ? (
          <div
            style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 300, width: 420 }}
          >
            {chart.bars.map((bar) => (
              <div
                key={bar.date}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  flex: 1,
                  height: '100%',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 22 }}>{bar.count}</span>
                <div
                  style={{
                    width: '100%',
                    height: Math.max((bar.count / max) * 240, bar.count ? 6 : 1),
                    background: palette.tint,
                  }}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', fontSize: 24, opacity: 0.75 }}>{town.domain}</div>
    </div>,
    {
      ...OG_SIZE,
      fonts: font ? [font] : undefined,
      headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
    },
  );
}
