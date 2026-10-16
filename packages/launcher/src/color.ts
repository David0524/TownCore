import { AA_TEXT, checkThemeContrast, contrastRatio, type Palette } from '@towncore/config';

// Color for generated themes (CLAUDE.md §11a quality floor; docs/plans/M7.md §5). Colors move in
// OKLCH lightness only, so a town keeps its hue while every text pair reaches WCAG AA.

type Oklch = { l: number; c: number; h: number };

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255)) as [
    number,
    number,
    number,
  ];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

function oklchToRgb({ l: L, c, h }: Oklch): [number, number, number] {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH to hex, lowering chroma until the color fits in sRGB (keeps lightness and hue). */
export function oklchToHex(color: Oklch): string {
  let c = color.c;
  for (let i = 0; i < 40; i++) {
    const rgb = oklchToRgb({ ...color, c });
    if (rgb.every((v) => v >= -0.0005 && v <= 1.0005)) {
      return `#${rgb
        .map((v) =>
          Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
        .toUpperCase()}`;
    }
    c *= 0.9;
  }
  const grey = Math.round(Math.min(1, Math.max(0, toGamma(color.l ** 3))) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${grey}${grey}${grey}`.toUpperCase();
}

const shift = (hex: string, dl: number) => {
  const c = hexToOklch(hex);
  return oklchToHex({ ...c, l: Math.min(1, Math.max(0, c.l + dl)) });
};

/** A palette from one brand hue: near-black ink, the accent, and light fills of the same hue. */
export function paletteFromAccent(accent: string, secondary?: string | null): Palette {
  const { h } = hexToOklch(accent);
  const palette: Palette = {
    ink: oklchToHex({ l: 0.2, c: 0.015, h }),
    accent: accent.toUpperCase(),
    accentText: '#FFFFFF',
    tint: oklchToHex({ l: 0.96, c: 0.02, h }),
    surface: oklchToHex({ l: 0.97, c: 0.006, h }),
    background: '#FFFFFF',
  };
  if (secondary) {
    palette.secondary = secondary.toUpperCase();
    palette.secondaryText =
      contrastRatio('#FFFFFF', secondary) >= AA_TEXT ? '#FFFFFF' : palette.ink;
  }
  return palette;
}

/**
 * Moves colors in lightness until every text pair passes AA (the theme schema refuses failures):
 * ink and accents get darker, fills get lighter. Returns the adjusted palette and what moved.
 */
export function adjustContrast(input: Palette): { palette: Palette; changed: string[] } {
  const p = { ...input };
  const changed = new Set<string>();
  for (let i = 0; i < 60; i++) {
    const failures = checkThemeContrast(p);
    if (failures.length === 0) break;
    for (const f of failures) {
      if (f.use === 'text on the sponsored tile' || (f.fg === 'ink' && f.bg === 'background')) {
        p.ink = shift(p.ink, -0.02);
        changed.add('ink');
      } else if (f.fg === 'ink') {
        p[f.bg] = shift(p[f.bg]!, 0.01);
        changed.add(f.bg);
      } else if (f.fg === 'accentText' || f.fg === 'accent') {
        p.accent = shift(p.accent, -0.02);
        changed.add('accent');
      } else if (f.fg === 'secondaryText' && p.secondary) {
        p.secondary = shift(p.secondary, p.secondaryText === '#FFFFFF' ? -0.02 : 0.02);
        changed.add('secondary');
      }
    }
  }
  const left = checkThemeContrast(p);
  if (left.length)
    throw new Error(`Couldn't reach AA for ${left.map((f) => `${f.fg} on ${f.bg}`).join(', ')}`);
  return { palette: p, changed: [...changed] };
}

/** Perceptual distance between two colors (OKLab ΔE); under ~0.1 reads as "the same color". */
export function colorDistance(a: string, b: string): number {
  const x = hexToOklch(a);
  const y = hexToOklch(b);
  const ax = x.c * Math.cos((x.h * Math.PI) / 180);
  const ay = x.c * Math.sin((x.h * Math.PI) / 180);
  const bx = y.c * Math.cos((y.h * Math.PI) / 180);
  const by = y.c * Math.sin((y.h * Math.PI) / 180);
  return Math.hypot(x.l - y.l, ax - bx, ay - by);
}
