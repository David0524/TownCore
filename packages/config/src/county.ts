import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import type { SourceKind, TownSourceConfig } from './town';

// The county source registry (owner, 2026-10-17: "source configs written by the system, not by
// hand"). One verified entry per county data set (property sales, permits, …) serves every town
// in the county: a town lists the kinds it takes (`county_sources: [property_sales]`) and gets
// the source with its own city-limits filter, built from the entry. Entries are written by
// launcher discovery as drafts and confirmed by a person; nothing here is guessed at run time.
//
// City limits: a county record's town is its legal jurisdiction, never its mailing city. Mailing
// cities ("BOCA RATON") include unincorporated areas, so a field holding one must never be used
// as city limits. An entry says how to find the jurisdiction instead:
//   parcel_prefix      — parcel numbers start with a municipality code (Palm Beach County: 06 =
//                        Boca Raton, 00 = unincorporated); `codes` maps each verified town to it.
//   jurisdiction_field — a column that holds the jurisdiction itself (not the mailing city), with
//                        the value per town when it isn't the town's name in capitals.
//   geocode            — no column says it; each record would be placed against city limits. Not
//                        built for county data yet, so a town on such an entry gets a to-do.

const column = z.string().regex(/^[A-Za-z_][\w]*$/, 'a column name');

export const countyRoles = [
  'date',
  'id',
  'address',
  'price',
  'use',
  'deed',
  'subdivision',
  'parcel',
  'value',
  'type',
  'work',
  'cost',
  'contractor',
  'status',
] as const;
export type CountyRole = (typeof countyRoles)[number];

const cityLimitsSchema = z.discriminatedUnion('method', [
  z.strictObject({
    method: z.literal('parcel_prefix'),
    field: column,
    /** Town name → municipality code, only codes checked against real parcels. */
    codes: z.record(z.string().min(1), z.string().regex(/^[0-9A-Za-z]+$/)),
  }),
  z.strictObject({
    method: z.literal('jurisdiction_field'),
    field: column,
    /** Town name → the field's value, when it isn't the name in capitals. */
    values: z.record(z.string().min(1), z.string().min(1)).default({}),
  }),
  z.strictObject({ method: z.literal('geocode') }),
]);
export type CityLimits = z.infer<typeof cityLimitsSchema>;

const countySourceSchema = z
  .strictObject({
    kind: z.enum(['property_sales', 'permits', 'inspections', 'police', 'fire', 'events']),
    platform: z.enum(['arcgis', 'socrata']),
    url: z.url({ protocol: /^https$/ }),
    label: z.string().min(1),
    /** When a person checked it live, and what robots.txt said (Rule 8). */
    verified: z.iso.date(),
    robots: z.string().min(1),
    roles: z.partialRecord(z.enum(countyRoles), column),
    /** The only columns requested and stored: never an owner's or a private person's name. */
    outFields: z.array(column).min(1).optional(),
    /** Filters for every town (real prices, not confidential), ANDed after city limits. */
    where: z.string().min(1).optional(),
    lagDays: z.number().int().positive().optional(),
    type: z.string().min(1).optional(),
    cityLimits: cityLimitsSchema,
  })
  .refine((s) => s.roles.date, { message: 'roles.date is required', path: ['roles', 'date'] })
  // Property records name owners: only listed columns may be fetched, which the ArcGIS adapter
  // supports (the Socrata adapter doesn't select columns yet).
  .refine((s) => s.kind !== 'property_sales' || (s.platform === 'arcgis' && s.outFields), {
    message: 'property_sales needs platform arcgis and outFields (owners are never fetched)',
    path: ['outFields'],
  })
  .refine((s) => !s.outFields || s.platform === 'arcgis', {
    message: 'outFields is only supported by the arcgis adapter',
    path: ['outFields'],
  });
export type CountySource = z.infer<typeof countySourceSchema>;

export const countyConfigSchema = z.strictObject({
  state: z.string().regex(/^[A-Z]{2}$/),
  /** As towns name it in their config ("Palm Beach"). */
  county: z.string().min(1),
  sources: z
    .array(countySourceSchema)
    .refine(
      (ss) => new Set(ss.map((s) => s.kind)).size === ss.length,
      'one source per kind per county',
    ),
});
export type CountyConfig = z.infer<typeof countyConfigSchema>;

/** counties/<state>/<slug>.yaml: "Palm Beach" → palm-beach. */
export const countySlug = (county: string) =>
  county
    .toLowerCase()
    .replace(/\s+county$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const countyKey = (state: string, county: string) => `${state.toUpperCase()}:${countySlug(county)}`;

export type CountyRegistry = Map<string, CountyConfig>;

export function parseCountyConfig(yamlText: string, label = 'county config'): CountyConfig {
  const result = countyConfigSchema.safeParse(parse(yamlText));
  if (!result.success) throw new Error(`Invalid ${label}:\n${z.prettifyError(result.error)}`);
  return result.data;
}

/** Loads counties/<state>/<slug>.yaml; a missing directory is an empty registry. */
export function loadCountyRegistry(dir: string): CountyRegistry {
  const registry: CountyRegistry = new Map();
  if (!existsSync(dir)) return registry;
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f) => join(dir, f))
    .filter((f) => statSync(f).isFile())
    .sort();
  for (const file of files) {
    const label = relative(dir, file);
    const config = parseCountyConfig(readFileSync(file, 'utf8'), label);
    const expected = `${config.state.toLowerCase()}/${countySlug(config.county)}`;
    if (label.replace(/\.ya?ml$/, '') !== expected)
      throw new Error(`${label}: file must be at counties/${expected}.yaml`);
    registry.set(countyKey(config.state, config.county), config);
  }
  return registry;
}

export function countyFor(
  registry: CountyRegistry,
  town: { state: string; county: string },
): CountyConfig | undefined {
  return registry.get(countyKey(town.state, town.county));
}

const quote = (v: string) => `'${v.replace(/'/g, "''")}'`;
const lookup = (map: Record<string, string>, name: string) =>
  Object.entries(map).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

/**
 * The filter that keeps one town's records inside its city limits, or why there isn't one
 * (no verified code for this town yet, or a method not built).
 */
export function cityLimitsFilter(
  limits: CityLimits,
  town: string,
): { where: string } | { error: string } {
  switch (limits.method) {
    case 'parcel_prefix': {
      const code = lookup(limits.codes, town);
      return code
        ? { where: `${limits.field} LIKE ${quote(`${code}%`)}` }
        : { error: `no verified ${limits.field} municipality code for ${town}` };
    }
    case 'jurisdiction_field':
      return {
        where: `${limits.field} = ${quote(lookup(limits.values, town) ?? town.toUpperCase())}`,
      };
    case 'geocode':
      return { error: 'city limits by geocoding are not built for county data yet' };
  }
}

/** What each kind's roles are called in the record text (the roundups read these labels). */
const ROLE_LABELS: Partial<Record<SourceKind, Array<[CountyRole, string]>>> = {
  property_sales: [
    ['address', 'Address'],
    ['price', 'Price'],
    ['date', 'Sale date'],
    ['deed', 'Deed'],
    ['use', 'Use'],
    ['subdivision', 'Subdivision'],
    ['parcel', 'Parcel'],
  ],
  permits: [
    ['id', 'Permit'],
    ['type', 'Type'],
    ['work', 'Work'],
    ['address', 'Address'],
    ['status', 'Status'],
    ['cost', 'Estimated cost'],
    ['contractor', 'Contractor'],
    ['date', 'Submitted'],
  ],
};
const TITLES: Partial<Record<SourceKind, string>> = {
  property_sales: '{address}',
  permits: '{type}: {work} at {address}',
};

/** One town's source from a county entry, or why it can't have one yet. */
export function townSourceFromCounty(
  source: CountySource,
  town: string,
): { source: TownSourceConfig } | { error: string } {
  const limits = cityLimitsFilter(source.cityLimits, town);
  if ('error' in limits) return { error: `${source.label}: ${limits.error}` };
  const roles = source.roles;
  const labels = ROLE_LABELS[source.kind] ?? [];
  const fields = Object.fromEntries(
    labels.flatMap(([role, label]) => (roles[role] ? [[roles[role], label]] : [])),
  );
  const title = TITLES[source.kind]?.replace(/\{(\w+)\}/g, (_, role: CountyRole) =>
    roles[role] ? `{${roles[role]}}` : '',
  );
  // The key order is part of the source's identity (packages/db towns.ts sourceKey): keep it.
  const options: Record<string, string | number | string[] | Record<string, string>> = {
    dateField: roles.date!,
    ...(roles.id ? { idField: roles.id } : {}),
    ...(title ? { title } : {}),
    where: [limits.where, source.where].filter(Boolean).join(' AND '),
    ...(source.outFields ? { outFields: source.outFields } : {}),
    ...(Object.keys(fields).length ? { fields } : {}),
    ...(source.lagDays ? { lagDays: source.lagDays } : {}),
    ...(source.type ? { type: source.type } : {}),
  };
  return { source: { kind: source.kind, platform: source.platform, url: source.url, options } };
}

/**
 * A town's county sources: each kind it lists, built from its county's entry. A kind its county
 * doesn't have, or a town without a verified city-limits filter, is an error at load time.
 */
export function countySourcesFor(
  registry: CountyRegistry,
  town: { name: string; state: string; county: string; county_sources?: SourceKind[] },
): TownSourceConfig[] {
  const kinds = town.county_sources ?? [];
  if (!kinds.length) return [];
  const county = countyFor(registry, town);
  if (!county)
    throw new Error(
      `${town.name}: county_sources needs counties/${town.state.toLowerCase()}/${countySlug(town.county)}.yaml`,
    );
  return kinds.map((kind) => {
    const entry = county.sources.find((s) => s.kind === kind);
    if (!entry) throw new Error(`${town.name}: ${county.county} County has no ${kind} source`);
    const built = townSourceFromCounty(entry, town.name);
    if ('error' in built) throw new Error(`${town.name}: ${built.error}`);
    return built.source;
  });
}
