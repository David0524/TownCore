import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { countySourcesFor, loadCountyRegistry } from './county';
import { guideTopicKeys } from './guides';
import { checkThemeForTown, defaultTheme, parseTheme, type Theme } from './theme';

// Town config schema (CLAUDE.md §10). Objects are strict: unknown keys fail, so a town
// can't sneak in brand overrides beyond site_name and logo.

export const TBD = 'TBD';

export const sourceKinds = [
  'agenda',
  'meeting_video',
  'permits',
  'property_sales',
  'business_filings',
  'inspections',
  'police',
  'fire',
  'schools',
  'weather',
  'events',
  // Official releases from a town's own government (e.g. CivicPlus News Flash).
  'city_news',
  // Official reference pages (city, county, state, utilities) that evergreen guides are written
  // from (M4 PR F). Never story material: the story finder ignores them.
  'reference',
  // Team schedules and results (high school athletic associations, licensed score feeds).
  'sports',
  'other_outlet',
] as const;
export type SourceKind = (typeof sourceKinds)[number];

export const townTiers = ['small', 'mid', 'large'] as const;
export type TownTier = (typeof townTiers)[number];

const timezones = new Set(Intl.supportedValuesOf('timeZone'));

const domain = z
  .string()
  .toLowerCase()
  .regex(/^(?!www\.)([a-z0-9-]+\.)+[a-z]{2,}$/, 'bare domain, lowercase, no www.');

/** Ingest interval: a number plus m/h/d, e.g. "15m", "3h", "7d". */
export const scheduleSchema = z.string().regex(/^\d+[mhd]$/, 'use an interval like 15m, 3h or 7d');

const sourceSchema = z.strictObject({
  kind: z.enum(sourceKinds),
  platform: z.string().min(1),
  url: z.union([z.literal(TBD), z.url()]).optional(),
  // NWS forecast zone, e.g. FLZ168.
  zone: z.string().min(1).optional(),
  // NWS forecast point "lat,lon" for the Today weather tile (hourly forecast), e.g. the city
  // center. Weather sources only.
  point: z
    .string()
    .regex(/^-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?$/, 'expected "lat,lon"')
    .optional(),
  // Beach tiles for coastal towns (D-M4b-3). Weather sources only. Kept out of `options` so
  // adding or changing them never changes the source's identity (its key).
  beach: z
    .strictObject({
      surf_office: z
        .string()
        .regex(/^[A-Z]{3}$/, 'expected an NWS office like "MFL"')
        .optional(),
      tide_station: z
        .string()
        .regex(/^\d{7}$/, 'expected a 7-digit NOAA station ID')
        .optional(),
      uv_zip: z
        .string()
        .regex(/^\d{5}$/, 'expected a 5-digit ZIP code')
        .optional(),
    })
    .optional(),
  schedule: scheduleSchema.optional(),
  // Other platform-specific settings, validated by the adapter.
  options: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.array(z.string()),
        // A column → label map (open-data field maps).
        z.record(z.string(), z.string()),
      ]),
    )
    .optional(),
});
export type TownSourceConfig = z.infer<typeof sourceSchema>;

export const townConfigSchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1),
  // What locals call the town, for friendly lines like "Good morning, Boca". Defaults to name.
  short_name: z.string().min(1).max(30).optional(),
  state: z.string().regex(/^[A-Z]{2}$/),
  census_id: z.string().min(1).optional(),
  county: z.string().min(1),
  timezone: z.string().refine((tz) => timezones.has(tz), 'unknown IANA timezone'),
  site_name: z.string().min(1),
  domain,
  extra_domains: z.array(domain).default([]),
  // A logo image in place of the generated wordmark: a path, or { src, width, height } so the
  // page reserves its shape before it loads (no layout shift).
  logo: z
    .union([
      z.string().min(1),
      z.object({
        src: z.string().min(1),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }),
    ])
    .optional(),
  // The town's own illustration beside the homepage greeting, in place of the motif drawing
  // (owner's art from its logo; decorative), with its size so the page reserves its shape.
  hero_art: z
    .object({
      src: z.string().min(1),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
  // A folder of ready-made icons (icon-32.png for the browser tab; icon-180, -192 and -512.png
  // for Home Screens and the app manifest), in place of the motif icons drawn in code.
  app_icon: z.string().min(1).optional(),
  // Public contact shown on the site; defaults to news@{domain} (forwarded to the publisher inbox).
  contact_email: z.email().optional(),
  tier: z.enum(townTiers),
  newsletter_send_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  same_name_elsewhere: z.array(z.string().min(1)).default([]),
  agencies: z.array(z.string().min(1)).min(1),
  sources: z.array(sourceSchema).default([]),
  // County data this town takes from its county's verified entry in counties/<state>/<county>.yaml
  // (owner, 2026-10-17): built per town with its own city-limits filter, appended to `sources`
  // when towns load. One county entry serves every town in the county.
  county_sources: z.array(z.enum(sourceKinds)).default([]),
  // Evergreen guides (CLAUDE.md §6a; D-M4-2): topics from the network list, each with the
  // official pages it's written from. Official pages only (Rule 3); added once verified live.
  guides: z
    .array(
      z.strictObject({
        topic: z.enum(guideTopicKeys),
        pages: z
          .array(z.url({ protocol: /^https$/ }))
          .min(1)
          .max(4),
      }),
    )
    .default([])
    .refine(
      (gs) => new Set(gs.map((g) => g.topic)).size === gs.length,
      'each guide topic may appear only once',
    ),
  // Editorial overrides (CLAUDE.md §6a); defaults in editorial.ts.
  story_budget: z.number().int().positive().optional(),
  score_threshold: z.number().min(0).max(100).default(40),
  // Daily AI spend cap (CLAUDE.md §8) and a call cap that also protects free-tier quotas.
  ai_daily_cap_usd: z.number().positive().default(5),
  ai_daily_call_cap: z.number().int().positive().default(400),
  // Monthly prices in whole dollars. Featured spots #1, #2 and #3 each have their own price,
  // and a business's first spot is free for `free_trial_days` (owner, 2026-10-16).
  pricing: z.strictObject({
    featured_usd: z.tuple([
      z.number().int().positive(),
      z.number().int().positive(),
      z.number().int().positive(),
    ]),
    enhanced_usd: z.number().int().positive(),
    free_trial_days: z.number().int().min(0).max(90).default(30),
  }),
});

export type TownConfig = z.infer<typeof townConfigSchema>;

export function parseTownConfig(yamlText: string, label = 'town config'): TownConfig {
  const result = townConfigSchema.safeParse(parse(yamlText));
  if (!result.success) {
    throw new Error(`Invalid ${label}:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/**
 * Loads every towns/<state>/<slug>.yaml under `dir`. The file path must match state and slug.
 * Each town's `county_sources` are built from the county registry (default: `counties/` beside
 * `dir`) and appended to its sources.
 */
export function loadTownConfigs(
  dir: string,
  countiesDir = join(dir, '..', 'counties'),
): TownConfig[] {
  const registry = loadCountyRegistry(countiesDir);
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'))
    .map((file) => join(dir, file))
    .filter((file) => statSync(file).isFile())
    .sort();

  const configs = files.map((file) => {
    const label = relative(dir, file);
    const config = parseTownConfig(readFileSync(file, 'utf8'), label);
    const expected = `${config.state.toLowerCase()}/${config.slug}`;
    if (label.replace(/\.ya?ml$/, '') !== expected) {
      throw new Error(`${label}: file must be at towns/${expected}.yaml`);
    }
    return withCountySources(config, registry);
  });

  for (const key of ['slug', 'domain'] as const) {
    const seen = new Set<string>();
    for (const config of configs) {
      if (seen.has(config[key])) throw new Error(`Duplicate town ${key}: ${config[key]}`);
      seen.add(config[key]);
    }
  }
  return configs;
}

/** The town with its `county_sources` built from the registry and appended to its sources. */
export function withCountySources(
  config: TownConfig,
  registry: ReturnType<typeof loadCountyRegistry>,
): TownConfig {
  const county = countySourcesFor(registry, config);
  return county.length ? { ...config, sources: [...config.sources, ...county] } : config;
}

export type LoadedTown = { config: TownConfig; theme: Theme; hasThemeFile: boolean };

/**
 * Loads every town config plus its theme (`<slug>.theme.json` next to the YAML). Towns without
 * a theme file get the network default theme. Theme rules that depend on the town are checked.
 */
export function loadTowns(dir: string, countiesDir?: string): LoadedTown[] {
  return loadTownConfigs(dir, countiesDir).map((config) => {
    const themeFile = join(dir, config.state.toLowerCase(), `${config.slug}.theme.json`);
    const hasThemeFile = existsSync(themeFile);
    const theme = hasThemeFile
      ? parseTheme(readFileSync(themeFile, 'utf8'), relative(dir, themeFile))
      : defaultTheme;
    const problems = checkThemeForTown(theme, config);
    if (problems.length > 0) {
      throw new Error(`${config.slug} theme: ${problems.join('; ')}`);
    }
    return { config, theme, hasThemeFile };
  });
}

/** The site's public contact address. */
/** What locals call the town ("Boca"), else its name. */
export function townShortName(config: Pick<TownConfig, 'name' | 'short_name'>): string {
  return config.short_name ?? config.name;
}

export function townContactEmail(config: Pick<TownConfig, 'domain' | 'contact_email'>): string {
  return config.contact_email ?? `news@${config.domain}`;
}

/** Lists config fields still set to TBD. A town can't go live until this is empty (M7). */
export function findTbdFields(config: unknown): string[] {
  const found: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (value === TBD) found.push(path);
    else if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${path}[${i}]`));
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(config, '');
  return found;
}
