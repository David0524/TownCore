import {
  brandColors,
  cornerRadii,
  defaultTheme,
  themeSchema,
  typePairings,
  type Theme,
} from '@towncore/config';

// Fallback stacks keep text readable while web fonts load.
const serifFallback = "Georgia, 'Times New Roman', serif";
const sansFallback = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** The town's theme, or the default theme if it has none (or an invalid one slipped in). */
export function themeFor(town: { slug: string; theme: unknown }): Theme {
  if (town.theme == null) return defaultTheme;
  const parsed = themeSchema.safeParse(town.theme);
  if (!parsed.success) {
    console.error(`Invalid theme for ${town.slug}; using the default theme.`, parsed.error.issues);
    return defaultTheme;
  }
  return parsed.data;
}

/** CSS custom properties for a theme. Components read only these, never literal values. */
export function themeCssVariables(theme: Theme): string {
  const { palette } = theme;
  const fonts = typePairings[theme.type];
  const vars: Record<string, string> = {
    '--ink': palette.ink,
    '--accent': palette.accent,
    '--accent-text': palette.accentText,
    '--tint': palette.tint,
    '--surface': palette.surface,
    '--background': palette.background,
    '--font-headline': `'${fonts.headline}', ${serifFallback}`,
    '--font-body': `'${fonts.body}', ${sansFallback}`,
    '--radius': cornerRadii[theme.corners],
  };
  return `:root{${Object.entries(vars)
    .map(([name, value]) => `${name}:${value};`)
    .join('')}}`;
}

/**
 * Tokens for staff pages (/admin): the TownCore network brand (CLAUDE.md §11), never shown on
 * town sites. Same token names as town themes, so the same components work.
 */
export function networkCssVariables(): string {
  const vars: Record<string, string> = {
    '--ink': brandColors.navy,
    '--accent': brandColors.navy,
    '--accent-text': brandColors.white,
    '--tint': brandColors.paper,
    '--surface': brandColors.paper,
    '--background': brandColors.white,
    '--muted': brandColors.slate,
    '--font-headline': sansFallback,
    '--font-body': sansFallback,
    '--radius': '4px',
  };
  return `:root{${Object.entries(vars)
    .map(([name, value]) => `${name}:${value};`)
    .join('')}}`;
}
