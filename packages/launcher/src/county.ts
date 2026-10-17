import { fileURLToPath } from 'node:url';
import {
  countyFor,
  countySlug,
  townSourceFromCounty,
  type CountyRegistry,
  type CountyRole,
} from '@towncore/config';
import { getAdapter, type Fetcher } from '@towncore/adapters';
import { stringify } from 'yaml';
import type { ResolvedTown } from './resolve';

// County data in a launch (owner, 2026-10-17: "source configs written by the system, not by
// hand"). When the town's county is in the registry (counties/<state>/<county>.yaml), each of its
// data sets is built for this town with its own city-limits filter and health-checked live; a
// town without a verified city-limits code gets a to-do. When the county isn't in the registry,
// discovery searches the platforms' documented catalogs (ArcGIS Online search, the Socrata
// Discovery API) for parcel, sales and permit data, scores candidates by their column names,
// and writes a draft registry entry for a person to confirm. Nothing it finds is trusted:
// drafts never reach a town's sources until a person moves them into counties/.

export const DEFAULT_COUNTIES_DIR = fileURLToPath(new URL('../../../counties', import.meta.url));

/** Kinds the county discovery looks for, with the roles a usable data set must have. */
const WANTED = {
  property_sales: { required: ['date', 'price', 'address'] as CountyRole[], words: 'sales' },
  permits: { required: ['date', 'address', 'type'] as CountyRole[], words: 'building permits' },
} as const;
type WantedKind = keyof typeof WANTED;

/** Column-name patterns per role. A data set is scored by the roles its columns fill. */
const ROLE_PATTERNS: Record<WantedKind, Partial<Record<CountyRole, RegExp>>> = {
  property_sales: {
    date: /^(sale_?d(ate|t)|saledate|deed_?date|transfer_?date|sale_?date_?\d?)$/i,
    price: /^(sale_?)?(price|amt|amount)$|^consideration$|^sale_?price\d?$/i,
    address: /^(site_?addr(ess)?(_str)?|situs(_?addr(ess)?)?|address|location|prop_?addr(ess)?)$/i,
    parcel: /^(parcel(_?(id|no|num(ber)?))?|pcn|apn|folio|pin)$/i,
    use: /^(property_?use|land_?use|use_?(code|desc)|dor_?(code|desc))$/i,
    deed: /^(instrument|deed_?type|sale_?type)$/i,
    id: /^(sale_?key|sale_?id|book_?page)$/i,
  },
  permits: {
    date: /^(issue(d)?_?d(ate|t)|applied_?d(ate|t)|submit(ted)?_?d(ate|t)|permit_?date|issued)$/i,
    id: /^(permit_?(id|no|num(ber)?)|record_?id|case_?(no|num(ber)?)|permitid)$/i,
    type: /^(permit_?type|work_?type|type)$/i,
    address: /^(address|site_?addr(ess)?|location|full_?addr(ess)?|fulladdr)$/i,
    cost: /^(valuation|est(imated)?_?cost|job_?value|value|estcost)$/i,
    status: /^(status|permit_?status|permitstat)$/i,
    contractor: /^contractor(_?name)?$/i,
    work: /^(desc(ription)?|work_?desc(ription)?|permitdesc)$/i,
  },
};
/** Columns that can name a private person: never in a draft's outFields. */
const PERSONAL = /owner|name|mail|grantee|grantor|buyer|seller|applicant|phone|email/i;
/** Columns that hold a jurisdiction or a mailing city: shown for a person to judge, never used. */
const PLACE = /muni|juris|city|town/i;

export type CountyCandidate = {
  kind: WantedKind;
  platform: 'arcgis' | 'socrata';
  url: string;
  title: string;
  roles: Partial<Record<CountyRole, string>>;
  /** Share of the kind's required roles found, 0–1. */
  score: number;
  /** Columns that might say the town: the person decides whether one is a true jurisdiction. */
  placeColumns: string[];
  /** Columns left out because they can name a person. */
  personal: string[];
};

export type CountyDetail = {
  county: string;
  state: string;
  /** In the registry: the kinds this town takes (written to county_sources). */
  registered: boolean;
  kinds: string[];
  /** What a person still has to do. */
  todos: string[];
  /** Not in the registry: the draft entry for a person to confirm, as YAML. */
  draft: string | null;
  candidates: CountyCandidate[];
};

/** Registered county: the town's county data sets, built and health-checked. */
async function registeredCounty(
  fetcher: Fetcher,
  town: Pick<ResolvedTown, 'name' | 'state' | 'county'>,
  registry: CountyRegistry,
  now: Date,
): Promise<CountyDetail | null> {
  const county = countyFor(registry, town);
  if (!county) return null;
  const kinds: string[] = [];
  const todos: string[] = [];
  for (const entry of county.sources) {
    const built = townSourceFromCounty(entry, town.name);
    if ('error' in built) {
      todos.push(
        `${built.error}: check real ${town.name} parcels and add the code to counties/${county.state.toLowerCase()}/${countySlug(county.county)}.yaml, then add "${entry.kind}" to county_sources.`,
      );
      continue;
    }
    const adapter = getAdapter(entry.platform);
    const health = await adapter!.healthCheck(
      {
        id: 'discovery',
        townId: 'discovery',
        kind: entry.kind,
        platform: entry.platform,
        url: entry.url,
        config: built.source.options ?? {},
      },
      { fetcher, now },
    );
    if (health.ok) kinds.push(entry.kind);
    else todos.push(`${entry.label} failed its health check: ${health.detail ?? 'no detail'}.`);
  }
  return {
    county: county.county,
    state: county.state,
    registered: true,
    kinds,
    todos,
    draft: null,
    candidates: [],
  };
}

function scoreColumns(kind: WantedKind, columns: string[]) {
  const roles: Partial<Record<CountyRole, string>> = {};
  for (const [role, pattern] of Object.entries(ROLE_PATTERNS[kind]) as Array<
    [CountyRole, RegExp]
  >) {
    const hit = columns.find((c) => pattern.test(c) && !PERSONAL.test(c));
    if (hit) roles[role] = hit;
  }
  const required = WANTED[kind].required;
  const score = required.filter((r) => roles[r]).length / required.length;
  return {
    roles,
    score,
    placeColumns: columns.filter((c) => PLACE.test(c) && !PERSONAL.test(c)),
    personal: columns.filter((c) => PERSONAL.test(c)),
  };
}

type ArcgisSearch = {
  results?: Array<{ title?: string; snippet?: string | null; url?: string | null }>;
};
type ArcgisService = {
  layers?: Array<{ id: number; name: string }>;
  tables?: Array<{ id: number; name: string }>;
};
type ArcgisLayer = { name?: string; fields?: Array<{ name: string }> };
type SocrataCatalog = {
  results?: Array<{
    resource?: {
      id?: string;
      name?: string;
      attribution?: string | null;
      columns_field_name?: string[];
    };
    metadata?: { domain?: string };
  }>;
};

/**
 * Both catalogs search every publisher, so a hit counts only when it says it is this county's:
 * "{County} County" in an ArcGIS item's title or summary, or a Socrata portal whose domain or
 * publisher names the county. A neighbor's or another state's data set is never drafted.
 */
export function mentionsCounty(county: string, texts: Array<string | null | undefined>): boolean {
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const name = flat(countySlug(county));
  return texts.some((t) => {
    if (!t) return false;
    const text = flat(t);
    return text.includes(`${name}county`) || text.includes(`countyof${name}`);
  });
}

const SERVICES_PER_SEARCH = 3;
const LAYERS_PER_SERVICE = 2;
const LAYER_NAME = /parcel|sale|propinfo|property|permit/i;

async function arcgisCandidates(
  fetcher: Fetcher,
  county: string,
  kind: WantedKind,
): Promise<CountyCandidate[]> {
  const q = `"${county} County" ${WANTED[kind].words} (type:"Feature Service" OR type:"Map Service")`;
  const search = await fetcher.getJson<ArcgisSearch>(
    `https://www.arcgis.com/sharing/rest/search?${new URLSearchParams({ q, f: 'json', num: '10' })}`,
  );
  const services = (search.results ?? [])
    .filter((r) => r.url && /\/(FeatureServer|MapServer)\/?$/i.test(r.url))
    .filter((r) => mentionsCounty(county, [r.title, r.snippet]))
    .slice(0, SERVICES_PER_SEARCH);
  const out: CountyCandidate[] = [];
  for (const service of services) {
    const base = service.url!.replace(/\/+$/, '');
    try {
      const info = await fetcher.getJson<ArcgisService>(`${base}?f=json`);
      const layers = [...(info.layers ?? []), ...(info.tables ?? [])]
        .filter((l) => LAYER_NAME.test(l.name))
        .slice(0, LAYERS_PER_SERVICE);
      for (const layer of layers) {
        const url = `${base}/${layer.id}`;
        const meta = await fetcher.getJson<ArcgisLayer>(`${url}?f=json`);
        const scored = scoreColumns(
          kind,
          (meta.fields ?? []).map((f) => f.name),
        );
        if (scored.score > 0)
          out.push({
            kind,
            platform: 'arcgis',
            url,
            title: `${service.title ?? 'ArcGIS service'}: ${meta.name ?? layer.name}`,
            ...scored,
          });
      }
    } catch {
      // A host robots.txt blocks (Rule 8) or a dead service is skipped, never worked around.
      continue;
    }
  }
  return out;
}

async function socrataCandidates(
  fetcher: Fetcher,
  county: string,
  kind: WantedKind,
): Promise<CountyCandidate[]> {
  const q = `${county} County ${WANTED[kind].words}`;
  const catalog = await fetcher.getJson<SocrataCatalog>(
    `https://api.us.socrata.com/api/catalog/v1?${new URLSearchParams({ q, only: 'dataset', limit: '10' })}`,
  );
  return (catalog.results ?? []).flatMap((r) => {
    const id = r.resource?.id;
    const domain = r.metadata?.domain;
    if (!id || !domain) return [];
    // A portal's domain names its publisher (data.browardcounty.gov), or its attribution does.
    if (!mentionsCounty(county, [domain, r.resource?.attribution])) return [];
    const scored = scoreColumns(kind, r.resource?.columns_field_name ?? []);
    // Property records name owners, and the Socrata adapter can't leave columns out yet.
    if (scored.score === 0 || kind === 'property_sales') return [];
    return [
      {
        kind,
        platform: 'socrata' as const,
        url: `https://${domain}/resource/${id}.json`,
        title: r.resource?.name ?? id,
        ...scored,
      },
    ];
  });
}

/** The best candidate per kind, as a registry entry for a person to finish and confirm. */
export function draftCountyYaml(
  town: Pick<ResolvedTown, 'state' | 'county'>,
  candidates: CountyCandidate[],
): string | null {
  const best = (Object.keys(WANTED) as WantedKind[]).flatMap((kind) => {
    const top = candidates
      .filter((c) => c.kind === kind && c.score >= 2 / 3)
      .sort(
        (a, b) => b.score - a.score || Object.keys(b.roles).length - Object.keys(a.roles).length,
      )[0];
    return top ? [top] : [];
  });
  if (!best.length) return null;
  const doc = {
    state: town.state,
    county: town.county,
    sources: best.map((c) => ({
      kind: c.kind,
      platform: c.platform,
      url: c.url,
      label: c.title,
      verified: 'TBD',
      robots: 'TBD: allowed when discovery read it; a person confirms',
      roles: c.roles,
      ...(c.platform === 'arcgis' ? { outFields: Object.values(c.roles) } : {}),
      cityLimits: 'TBD',
    })),
  };
  const notes = best
    .map(
      (c) =>
        `#   ${c.kind}: ${c.title} (${Math.round(c.score * 100)}% of required roles). Columns that may hold the town: ${c.placeColumns.join(', ') || 'none'}. Left out as personal: ${c.personal.join(', ') || 'none'}.`,
    )
    .join('\n');
  return `# DRAFT county entry written by launch discovery, not verified. A person checks each data
# set live (robots.txt, terms, the fields), sets cityLimits (parcel municipality codes or a
# column that is truly the jurisdiction, never a mailing city), fills verified and robots, and
# moves the file to counties/${town.state.toLowerCase()}/${countySlug(town.county)}.yaml.
${notes}
${stringify(doc)}`;
}

/** The near misses, so a person knows where discovery looked. */
function partial(candidates: CountyCandidate[]): string {
  if (!candidates.length) return '';
  const list = candidates
    .slice(0, 3)
    .map((c) => `${c.title} (${c.kind}, ${Math.round(c.score * 100)}%)`)
    .join('; ');
  return ` (partial matches: ${list})`;
}

/** Launch step 3's county part: the registry's data sets for this town, or a draft entry. */
export async function countyDiscovery(
  fetcher: Fetcher,
  town: Pick<ResolvedTown, 'name' | 'state' | 'county'>,
  registry: CountyRegistry,
  now: Date = new Date(),
): Promise<CountyDetail> {
  const registered = await registeredCounty(fetcher, town, registry, now);
  if (registered) return registered;
  const candidates: CountyCandidate[] = [];
  for (const kind of Object.keys(WANTED) as WantedKind[]) {
    for (const search of [arcgisCandidates, socrataCandidates]) {
      try {
        candidates.push(...(await search(fetcher, town.county, kind)));
      } catch {
        // A catalog that's down or refuses us leaves a to-do, not a failed launch.
      }
    }
  }
  const draft = draftCountyYaml(town, candidates);
  return {
    county: town.county,
    state: town.state,
    registered: false,
    kinds: [],
    todos: draft
      ? [
          `${town.county} County isn't in the county registry: confirm the draft entry (county-draft.yaml in this launch's folder) and move it to counties/${town.state.toLowerCase()}/${countySlug(town.county)}.yaml.`,
        ]
      : [
          `${town.county} County isn't in the county registry, and discovery found no parcel, sales or permit data set with the columns a story needs${partial(candidates)}: look on the county's GIS or open-data site.`,
        ],
    draft,
    candidates,
  };
}
