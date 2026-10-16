import {
  beatCategory,
  brandColors,
  categoryColors,
  cornerRadii,
  darkColors,
  deriveMuted,
  iosColors,
  iosFonts,
  iosRadii,
  phoneSecondaryLabel,
  systemColors,
  defaultTheme,
  themeSchema,
  typePairings,
  type Theme,
} from '@towncore/config';

// Fallback stacks keep text readable while web fonts load.
const serifFallback = "Georgia, 'Times New Roman', serif";
const sansFallback = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const monoFallback = "ui-monospace, 'SF Mono', Menlo, monospace";
const chartFont = "'Space Grotesk Variable'";
// Today tiles are rounder than images in soft and round themes (canvas: 6px images, 16px tiles).
const tileRadii = { square: '0', soft: '16px', round: '16px' } as const;

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

const css = (selector: string, vars: Record<string, string>) =>
  `${selector}{${Object.entries(vars)
    .map(([name, value]) => `${name}:${value};`)
    .join('')}}`;

/** The category color a beat's dot uses (fixed meanings network-wide, docs/plans/M4b.md). */
export const beatColorVar = (beat: string) => `var(--cat-${beatCategory[beat] ?? 'news'})`;

/**
 * CSS custom properties for a theme. Components read only these, never literal values. The
 * town supplies palette, fonts and corners; the network supplies category colors, the sponsored
 * sand, alert amber and hairlines, which mean the same thing on every site.
 */
export function themeCssVariables(theme: Theme): string {
  const { palette } = theme;
  const fonts = typePairings[theme.type];
  const metaFallback = fonts.metaStyle === 'mono' ? monoFallback : sansFallback;
  const vars: Record<string, string> = {
    '--ink': palette.ink,
    '--accent': palette.accent,
    '--accent-text': palette.accentText,
    '--secondary': palette.secondary ?? palette.accent,
    '--secondary-text': palette.secondary
      ? (palette.secondaryText ?? palette.accentText)
      : palette.accentText,
    '--tint': palette.tint,
    '--surface': palette.surface,
    '--background': palette.background,
    '--muted': deriveMuted(palette),
    '--rule': systemColors.rule,
    '--sand': systemColors.sand,
    '--alert': systemColors.alert,
    '--alert-text': systemColors.alertText,
    ...Object.fromEntries(Object.entries(categoryColors).map(([k, v]) => [`--cat-${k}`, v])),
    '--font-headline': `'${fonts.headline}', ${serifFallback}`,
    '--font-body': `'${fonts.body}', ${sansFallback}`,
    '--font-meta': `'${fonts.meta}', ${metaFallback}`,
    '--meta-style': fonts.metaStyle === 'italic' ? 'italic' : 'normal',
    '--headline-weight': String(fonts.headlineWeight),
    // The wordmark is the town's brand: its own face on every screen, phones included.
    '--font-wordmark': `'${fonts.headline}', ${serifFallback}`,
    // Charts and data graphics use one network face, apart from every town's headlines.
    '--font-chart': `${chartFont}, ${sansFallback}`,
    '--radius': cornerRadii[theme.corners],
    '--radius-tile': tileRadii[theme.corners],
    // iOS chrome (phones only; see phoneCssVariables). Set everywhere so the tokens resolve.
    '--font-display': `'${fonts.headline}', ${serifFallback}`,
    '--ios-grouped': iosColors.grouped,
    '--ios-fill': iosColors.fill,
    '--ios-chrome': iosColors.chrome,
    '--ios-separator': iosColors.separator,
    '--ios-switch-on': iosColors.switchOn,
    '--ios-switch-off': iosColors.switchOff,
    '--ios-scrim': iosColors.scrim,
    '--radius-field': iosRadii.field,
    '--radius-button': iosRadii.button,
    '--radius-group': iosRadii.group,
    '--radius-widget': iosRadii.widget,
    '--radius-capsule': iosRadii.capsule,
  };
  // Dark mode: the same roles on a near-black page. Built now, switched on later.
  const dark: Record<string, string> = {
    '--ink': darkColors.ink,
    '--background': darkColors.background,
    '--surface': darkColors.surface,
    '--tint': darkColors.tint,
    '--muted': darkColors.muted,
    '--rule': darkColors.rule,
    '--sand': darkColors.sand,
  };
  return (
    css(':root', vars) +
    css(':root[data-color-scheme="dark"]', dark) +
    `@media (max-width: 599.98px){${css(':root', phoneCssVariables(theme))}}` +
    `@media (prefers-reduced-transparency: reduce){${css(':root', { '--ios-chrome': iosColors.chromeSolid })}}`
  );
}

/**
 * Phones (below 600px) wear Apple-native chrome on every town (docs/plans/M4b.md revision 5):
 * system fonts (San Francisco for text and headlines, no mono; the owner dropped the New York serif
 * on 2026-10-16), iOS system colors and shapes, with the town's brand as the tint. Towns still
 * differ by tint, wordmark (in the town's own face) and modules.
 */
function phoneCssVariables(theme: Theme): Record<string, string> {
  const { palette } = theme;
  return {
    '--ink': iosColors.label,
    '--muted': phoneSecondaryLabel(palette),
    '--rule': iosColors.separator,
    '--surface': iosColors.grouped,
    '--font-headline': iosFonts.display,
    '--font-body': iosFonts.text,
    '--font-display': iosFonts.display,
    '--font-meta': iosFonts.text,
    '--meta-style': 'normal',
    '--headline-weight': '700',
    '--radius': iosRadii.field,
    '--radius-tile': iosRadii.widget,
  };
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
    '--secondary': brandColors.navy,
    '--secondary-text': brandColors.white,
    '--tint': brandColors.paper,
    '--surface': brandColors.paper,
    '--background': brandColors.white,
    '--muted': brandColors.slate,
    '--rule': brandColors.paper,
    '--sand': brandColors.paper,
    '--alert': systemColors.alert,
    '--alert-text': systemColors.alertText,
    '--font-headline': sansFallback,
    '--font-body': sansFallback,
    '--font-meta': sansFallback,
    '--meta-style': 'normal',
    '--headline-weight': '700',
    '--radius': '4px',
    '--radius-tile': '4px',
  };
  return css(':root', vars);
}
