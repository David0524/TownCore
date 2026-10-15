import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
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
  schedule: scheduleSchema.optional(),
  // Other platform-specific settings, validated by the adapter.
  options: z.record(z.string(), z.union([z.string(), z.number(), z.array(z.string())])).optional(),
});
export type TownSourceConfig = z.infer<typeof sourceSchema>;

export const townConfigSchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1),
  state: z.string().regex(/^[A-Z]{2}$/),
  census_id: z.string().min(1).optional(),
  county: z.string().min(1),
  timezone: z.string().refine((tz) => timezones.has(tz), 'unknown IANA timezone'),
  site_name: z.string().min(1),
  domain,
  extra_domains: z.array(domain).default([]),
  logo: z.string().min(1).optional(),
  // Public contact shown on the site; defaults to news@{domain} (forwarded to the publisher inbox).
  contact_email: z.email().optional(),
  tier: z.enum(townTiers),
  newsletter_send_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  same_name_elsewhere: z.array(z.string().min(1)).default([]),
  agencies: z.array(z.string().min(1)).min(1),
  sources: z.array(sourceSchema).default([]),
  // Editorial overrides (CLAUDE.md §6a); defaults in editorial.ts.
  story_budget: z.number().int().positive().optional(),
  score_threshold: z.number().min(0).max(100).default(40),
  // Daily AI spend cap (CLAUDE.md §8) and a call cap that also protects free-tier quotas.
  ai_daily_cap_usd: z.number().positive().default(5),
  ai_daily_call_cap: z.number().int().positive().default(400),
  pricing: z.strictObject({
    sponsored_slot_usd: z.number().int().positive(),
    enhanced_usd: z.number().int().positive(),
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

/** Loads every towns/<state>/<slug>.yaml under `dir`. The file path must match state and slug. */
export function loadTownConfigs(dir: string): TownConfig[] {
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
    return config;
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

export type LoadedTown = { config: TownConfig; theme: Theme; hasThemeFile: boolean };

/**
 * Loads every town config plus its theme (`<slug>.theme.json` next to the YAML). Towns without
 * a theme file get the network default theme. Theme rules that depend on the town are checked.
 */
export function loadTowns(dir: string): LoadedTown[] {
  return loadTownConfigs(dir).map((config) => {
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
