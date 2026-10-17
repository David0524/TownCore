import { titleCase } from '@towncore/config';
import { apDate } from './time';

// Items built in code from structured records (CLAUDE.md §6 step 2: "templated jobs, not
// candidates"). No model writes them, so every fact is copied straight from a record; the
// tier router and publish rules still apply. Roundups link out to the official pages.
//
// The same template runs in thousands of towns, so each one leads with the town's own facts
// (the biggest item, the mix, how the week compares with the town's own past weeks) and keeps
// its fixed sentences to the few caveats readers need (owner, 2026-10-17: no near-duplicates
// across towns; CI checks it in test/near-duplicate.test.ts). Never pad to vary the text.

export type TemplateRecord = {
  id: string;
  type: string;
  title: string | null;
  text: string | null;
  url: string | null;
  occurredAt: Date | null;
  raw: unknown;
};

export type TemplatedDraft = {
  headline: string;
  dek: string;
  bodyMd: string;
  beat: string;
  sourceRecordIds: string[];
};

/** The weekly roundups, by the name in their candidate key ("roundup:<kind>:<week>"). */
export type RoundupKind =
  | 'meetings'
  | 'new-businesses'
  | 'new-licenses'
  | 'new-places'
  | 'permits'
  | 'sales'
  | 'inspections'
  | 'roads';

type TownInfo = { name: string; timezone: string; agency: string };

const byTime = (a: TemplateRecord, b: TemplateRecord) =>
  (a.occurredAt?.getTime() ?? 0) - (b.occurredAt?.getTime() ?? 0);

// Markdown-escape text that came from a record (names can contain * _ [ ]).
const md = (s: string) => s.replace(/([\\*_[\]`<>])/g, '\\$1');

const weekRange = (town: TownInfo, weekStart: Date) =>
  `${apDate(weekStart, town.timezone)}–${apDate(new Date(weekStart.getTime() + 6 * 86_400_000), town.timezone)}`;

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** "a, b and c". */
const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** "3 limited liability companies": a count with its noun, singular or plural. */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The entries of a tally, largest first, ties alphabetically. */
const ranked = (tally: Map<string, number>) =>
  [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

const tally = <T>(items: T[], key: (item: T) => string | null) => {
  const out = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k) out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
};

/**
 * How this week compares with the town's own past weeks (`past`: counts in the same units, the
 * week before first; empty when the town has no earlier data). Null when there's nothing to
 * compare with: a missing comparison is better than an invented one.
 */
export function weekTrend(n: number, past: number[] = []): string | null {
  if (!past.length) return null;
  const prev = past[0]!;
  const base =
    n > prev
      ? `up from ${prev} the week before`
      : n < prev
        ? `down from ${prev} the week before`
        : 'as many as the week before';
  if (past.length >= 3) {
    if (n > Math.max(...past)) return `${base}, and the most in ${past.length + 1} weeks`;
    if (n < Math.min(...past)) return `${base}, and the fewest in ${past.length + 1} weeks`;
  }
  return base;
}

const withTrend = (n: number, past?: number[]) => {
  const t = weekTrend(n, past);
  return t ? `, ${t}` : '';
};

// State records give a mailing city, not a municipality: a "Boca Raton" address can be outside
// city limits (e.g. West Boca). Roundups from state files say so, in a short clause.
const OUTSIDE_LIMITS = 'Addresses can be outside city limits.';

/** "Meetings this week" (D-M3-6): each public meeting on the city calendar for the week. */
export function meetingsRoundup(
  town: TownInfo,
  weekStart: Date,
  meetings: TemplateRecord[],
  past?: number[],
): TemplatedDraft {
  const range = weekRange(town, weekStart);
  const sorted = [...meetings].sort(byTime);
  const weekday = (d: Date) =>
    new Intl.DateTimeFormat('en-US', { timeZone: town.timezone, weekday: 'long' }).format(d);
  const items = sorted.map((m) => {
    const lines = Object.fromEntries(
      (m.text ?? '')
        .split('\n')
        .map((line) => line.match(/^(When|Where): (.*)$/))
        .filter((x): x is RegExpMatchArray => x !== null)
        .map((x) => [x[1], x[2]]),
    );
    const parts = [lines.When, lines.Where].filter(Boolean).map((p) => md(p!));
    const link = m.url ? ` [Agenda and details](${m.url})` : '';
    const details = parts.join('; ');
    const end = details && !details.endsWith('.') ? '.' : '';
    return `- **${md(m.title ?? 'Meeting')}**: ${details}${end}${link}`;
  });
  const n = meetings.length;
  const first = sorted[0];
  const firstLine = first
    ? `${first.title ?? 'A meeting'}${first.occurredAt ? ` on ${weekday(first.occurredAt)}` : ''}`
    : '';
  const byDay = tally(sorted, (m) => (m.occurredAt ? weekday(m.occurredAt) : null));
  const [busiest] = ranked(byDay);
  const busiestTitles = busiest
    ? sorted
        .filter((m) => m.occurredAt && weekday(m.occurredAt) === busiest[0])
        .map((m) => md(m.title ?? 'a meeting'))
    : [];
  return {
    headline: `Public meetings in ${town.name}, ${range}`,
    dek:
      n === 1
        ? `${firstLine} is the only public meeting on the ${town.agency} calendar${withTrend(n, past)}.`
        : `${count(n, 'public meeting', 'public meetings')} on the ${town.agency} calendar${withTrend(n, past)}, starting with ${firstLine}.`,
    bodyMd: [
      busiest && busiest[1] > 1 && byDay.size > 1
        ? `${busiest[0]} is the busiest day: ${list(busiestTitles)}.`
        : null,
      items.join('\n'),
    ]
      .filter(Boolean)
      .join('\n\n'),
    beat: 'government',
    sourceRecordIds: meetings.map((m) => m.id),
  };
}

type Filing = { name?: string; number?: string; fileDate?: string; zip?: string };

/** A Florida filing type in short plain words, singular and plural. */
function filingKind(kind: string): [string, string] {
  const k = kind.toLowerCase();
  const out = /foreign/.test(k) ? 'out-of-state ' : '';
  if (/limited liability/.test(k)) return [`${out}LLC`, `${out}LLCs`];
  if (/not for profit|nonprofit/.test(k)) return [`${out}nonprofit`, `${out}nonprofits`];
  if (/partnership/.test(k)) return [`${out}partnership`, `${out}partnerships`];
  if (/corporation/.test(k)) return [`${out}corporation`, `${out}corporations`];
  return [k.replace(/^florida /, ''), `${k.replace(/^florida /, '')} filings`];
}

/** MM/DD/YYYY → "Oct. 13". */
const mdyToAp = (value: string | undefined, timeZone: string) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value ?? '');
  return m ? apDate(new Date(Date.UTC(+m[3]!, +m[1]! - 1, +m[2]!, 12)), timeZone) : null;
};

/** "New businesses registered" from Florida Division of Corporations daily filings. */
export function newBusinessesRoundup(
  town: TownInfo,
  weekStart: Date,
  filings: TemplateRecord[],
  past?: number[],
): TemplatedDraft {
  const range = weekRange(town, weekStart);
  const rows = filings
    .map((f) => {
      const raw = (f.raw ?? {}) as Filing;
      // The record text starts "<kind>, document number <n>, filed <MM/DD/YYYY>."
      const kind = filingKind(f.text?.match(/^(.*?), document number/)?.[1] ?? 'Filing');
      const filed = mdyToAp(f.text?.match(/, filed (\d{2}\/\d{2}\/\d{4})\./)?.[1], town.timezone);
      // Principal addresses are often homes: list the ZIP code only.
      const zip = raw.zip?.slice(0, 5) ?? null;
      return { name: f.title ?? raw.name ?? '', kind, filed, zip };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const n = filings.length;
  const kinds = ranked(tally(rows, (r) => r.kind[0]));
  const plurals = new Map(rows.map((r) => [r.kind[0], r.kind[1]]));
  const mix = kinds.map(([k, c]) => `${c} ${c === 1 ? k : plurals.get(k)}`);
  const [topZip] = ranked(tally(rows, (r) => r.zip));
  return {
    headline: `New businesses registered with a ${town.name} address, ${range}`,
    dek: `${list(n > 2 ? [...rows.slice(0, 2).map((r) => titleCase(r.name)), `${n - 2} more`] : rows.map((r) => titleCase(r.name)))} registered with a ${town.name} mailing address${withTrend(n, past)}.`,
    bodyMd: [
      [
        kinds.length > 1 ? `By type: ${list(mix)}.` : null,
        topZip && topZip[1] > 1 ? `ZIP code ${topZip[0]} had the most, ${topZip[1]}.` : null,
        `Filings aren't openings. ${OUTSIDE_LIMITS}`,
      ]
        .filter(Boolean)
        .join(' '),
      rows
        .map(
          (r) =>
            `- **${md(r.name)}**${r.zip ? ` (ZIP ${r.zip})` : ''}: ${r.kind[0]}${r.filed ? `, ${r.filed}` : ''}`,
        )
        .join('\n'),
    ].join('\n\n'),
    beat: 'business',
    sourceRecordIds: filings.map((f) => f.id),
  };
}

type License = {
  licenseeName?: string;
  dbaName?: string;
  occupation?: string;
  licenseNumber?: string;
  alternateLicenseNumber?: string;
  occupationCode?: string;
};

/**
 * True for a DBPR row that is an actual license. "Construction Business Information" rows
 * (occupation code QB) have no license number: they register the company a licensed
 * qualifier works under, so they don't belong in a list of new licenses.
 */
export function isIssuedLicense(raw: unknown): boolean {
  const l = (raw ?? {}) as License;
  return Boolean(l.alternateLicenseNumber?.trim() || l.licenseNumber?.trim());
}

/** New contractor and electrician licenses (Florida DBPR) first issued in the week. */
export function newLicensesRoundup(
  town: TownInfo,
  weekStart: Date,
  licenses: TemplateRecord[],
  past?: number[],
): TemplatedDraft {
  const range = weekRange(town, weekStart);
  const rows = licenses
    .map((l) => {
      const raw = (l.raw ?? {}) as License;
      const license =
        raw.alternateLicenseNumber || `${raw.occupationCode ?? ''}${raw.licenseNumber ?? ''}`;
      return {
        name: raw.dbaName || raw.licenseeName || l.title || '',
        occupation: raw.occupation ?? null,
        license: license || null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const n = licenses.length;
  const trades = ranked(tally(rows, (r) => r.occupation?.toLowerCase() ?? null)).map(
    ([o, c]) => `${c} ${c === 1 ? o : `${o}s`}`,
  );
  return {
    headline: `New contractor licenses with a ${town.name} address, ${range}`,
    dek: `${trades.length ? list(trades) : count(n, 'contractor', 'contractors')} with a ${town.name} mailing address got ${n === 1 ? 'a first state license' : 'first state licenses'}${withTrend(n, past)}.`,
    bodyMd: [
      rows
        .map(
          (r) =>
            `- **${md(r.name)}**: ${md([r.occupation, r.license ? `license ${r.license}` : null].filter(Boolean).join(', '))}`,
        )
        .join('\n'),
      `Verify a license with the state before hiring. ${OUTSIDE_LIMITS}`,
    ].join('\n\n'),
    beat: 'business',
    sourceRecordIds: licenses.map((l) => l.id),
  };
}

const COMPANY_NAME =
  /\b(LLC|L\.L\.C|INC|CORP|CORPORATION|CO|COMPANY|LP|LLP|LTD|GROUP|HOLDINGS|ENTERPRISES)\b/i;

/** Food service licenses that mean a place to eat, in plain words (vending and events left out). */
const NEW_FOOD_KINDS: Record<string, [string, string]> = {
  'Permanent Food Service, seating': ['restaurant with seating', 'restaurants with seating'],
  'Permanent Food Service, non-seating': ['takeout or counter spot', 'takeout or counter spots'],
  Catering: ['caterer', 'caterers'],
  'Mobile Food Dispensing Vehicle': ['food truck', 'food trucks'],
};

type NewFood = {
  businessName?: string;
  licenseeName?: string;
  occupation?: string;
  address1?: string;
  approvedDate?: string;
};
type NewLiquor = { business?: string; sells?: string; street?: string; activityDate?: string };

type Place = { name: string; street: string; notes: string[]; kinds: string[]; ids: string[] };

/**
 * New places from new food service and liquor licenses, one per place (a place's food and liquor
 * licenses merge). Named by trade name, or the license holder only when that is a company.
 */
function newPlaces(items: TemplateRecord[]): Place[] {
  const places = new Map<string, Place>();
  const add = (name: string, street: string, note: string, kind: string, id: string) => {
    const key = `${name.toUpperCase().replace(/[^A-Z0-9]/g, '')}|${street.toUpperCase().slice(0, 12)}`;
    const place = places.get(key) ?? { name, street, notes: [], kinds: [], ids: [] };
    if (!place.notes.includes(note)) place.notes.push(note);
    if (!place.kinds.includes(kind)) place.kinds.push(kind);
    place.ids.push(id);
    places.set(key, place);
  };
  for (const item of items) {
    if (item.type === 'new_food_license') {
      const raw = (item.raw ?? {}) as NewFood;
      const kind = NEW_FOOD_KINDS[raw.occupation ?? ''];
      const name =
        raw.businessName ||
        (raw.licenseeName && COMPANY_NAME.test(raw.licenseeName) ? raw.licenseeName : '');
      if (!kind || !name) continue;
      add(titleCase(name), titleCase(raw.address1 ?? ''), `new ${kind[0]}`, kind[0], item.id);
    } else if (item.type === 'liquor_license') {
      const raw = (item.raw ?? {}) as NewLiquor;
      if (!raw.business) continue;
      add(
        titleCase(raw.business),
        titleCase(raw.street ?? ''),
        `liquor license for ${raw.sells}`,
        'liquor license',
        item.id,
      );
    }
  }
  return [...places.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const PLACE_PLURALS: Record<string, string> = {
  ...Object.fromEntries(Object.values(NEW_FOOD_KINDS)),
  'liquor license': 'liquor licenses',
};

/**
 * New places to eat and drink (owner, 2026-10-17): new food service establishments the state
 * approved and new alcoholic beverage licenses, the same week, one line per place. Built in code,
 * Tier 1. A place is named by its trade name, or its license holder only when that is a company,
 * never a person. Addresses are mailing cities, like the other state roundups.
 */
export function newPlacesRoundup(
  town: TownInfo,
  weekStart: Date,
  items: TemplateRecord[],
  past?: number[],
): TemplatedDraft {
  const range = weekRange(town, weekStart);
  const rows = newPlaces(items);
  const n = rows.length;
  const mix = ranked(
    tally(
      rows.flatMap((r) => r.kinds),
      (k) => k,
    ),
  ).map(([k, c]) => `${c} ${c === 1 ? k : (PLACE_PLURALS[k] ?? k)}`);
  const named = rows.slice(0, 2).map((r) => r.name);
  return {
    headline: `New places to eat and drink with a ${town.name} address, ${range}`,
    dek: `${list(n > 2 ? [...named, `${n - 2} more`] : named)} got state approval to serve food or drink${withTrend(n, past)}.`,
    bodyMd: [
      `${list(mix)}, from state food service and liquor license records. Approval comes before opening day. ${OUTSIDE_LIMITS}`,
      rows
        .map(
          (r) =>
            `- **${md(r.name)}**${r.street ? `, ${md(r.street)}` : ''}: ${r.notes.join('; ')}.`,
        )
        .join('\n'),
    ].join('\n\n'),
    beat: 'business',
    sourceRecordIds: rows.flatMap((r) => r.ids),
  };
}

type Inspection = {
  licenseNumber?: string;
  business?: string;
  address?: string;
  date?: string;
  disposition?: string;
  visit?: number;
  total?: number;
  highPriority?: number;
  severity?: 'closure' | 'complaint' | 'warning' | 'ok';
};

const SEVERITY_RANK = { ok: 0, warning: 1, complaint: 2, closure: 3 } as const;

/** True when any inspection in the list led to a closure order or an administrative complaint. */
export function hasInspectionFailures(raws: unknown[]): boolean {
  return raws.some((r) => {
    const s = ((r ?? {}) as Inspection).severity;
    return s === 'closure' || s === 'complaint';
  });
}

const INSPECTIONS_PAGE = 'https://www2.myfloridalicense.com/hotels-restaurants/public-records/';

/** MM/DD/YYYY sort key. */
const mdy = (d: string | undefined) => (d ?? '').replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3$1$2');

/** Inspection visits grouped by establishment, each judged by its most serious visit. */
function inspectedPlaces(inspections: TemplateRecord[]) {
  const groups = new Map<string, Inspection[]>();
  for (const r of inspections) {
    const raw = (r.raw ?? {}) as Inspection;
    const key = raw.licenseNumber || raw.business || r.id;
    groups.set(key, [...(groups.get(key) ?? []), raw]);
  }
  return [...groups.values()].map((visits) => {
    const sorted = [...visits].sort((a, b) => mdy(a.date).localeCompare(mdy(b.date)));
    const worst = sorted.reduce((w, v) =>
      SEVERITY_RANK[v.severity ?? 'ok'] > SEVERITY_RANK[w.severity ?? 'ok'] ? v : w,
    );
    const latest = sorted.at(-1)!;
    const fixedLater =
      worst !== latest && (latest.severity ?? 'ok') === 'ok' && mdy(latest.date) > mdy(worst.date)
        ? latest.date
        : null;
    return { name: titleCase(worst.business ?? ''), worst, fixedLater };
  });
}

/**
 * Last week's state food service inspections (Florida DBPR), one line per establishment under
 * its most serious result that week: the visit's date, violation counts and, when a later
 * call-back the same week found the problems fixed, that too. Places that met standards are
 * listed by name. A week with any closure or complaint goes to review (Tier 3, §7), since it
 * names businesses.
 */
export function inspectionsRoundup(
  town: TownInfo,
  weekStart: Date,
  inspections: TemplateRecord[],
  past?: number[],
): TemplatedDraft {
  const range = weekRange(town, weekStart);
  const places = inspectedPlaces(inspections);
  const by = (sev: keyof typeof SEVERITY_RANK) =>
    places
      .filter((p) => (p.worst.severity ?? 'ok') === sev)
      .sort((a, b) => a.name.localeCompare(b.name));
  const closures = by('closure');
  const complaints = by('complaint');
  const warnings = by('warning');
  const passed = by('ok');
  const line = (p: (typeof places)[number]) => {
    const v = p.worst;
    const hp = v.highPriority ?? 0;
    const parts = [
      v.address ? md(titleCase(v.address)) : null,
      v.date ? `inspected ${v.date}${(v.visit ?? 1) > 1 ? ' (call-back visit)' : ''}` : null,
      `${v.total ?? 0} ${v.total === 1 ? 'violation' : 'violations'}, ${hp} high priority`,
      p.fixedLater ? `a call-back visit on ${p.fixedLater} found it in compliance` : null,
    ].filter(Boolean);
    return `- **${md(p.name)}**: ${parts.join('; ')}.`;
  };
  const section = (title: string, group: typeof places, note: string) =>
    group.length ? [`## ${title}`, note, group.map(line).join('\n')].join('\n\n') : null;
  const counts = [
    closures.length ? `${closures.length} ordered closed` : null,
    complaints.length ? `${complaints.length} with an administrative complaint recommended` : null,
  ].filter(Boolean);
  const n = places.length;
  const names = (group: typeof places) => list(group.map((p) => md(p.name)));
  const mostCited = [...places].sort(
    (a, b) =>
      (b.worst.highPriority ?? 0) - (a.worst.highPriority ?? 0) ||
      (b.worst.total ?? 0) - (a.worst.total ?? 0),
  )[0];
  const lead = closures.length
    ? `Inspectors ordered ${names(closures)} closed until a follow-up visit finds the problems fixed.`
    : complaints.length
      ? `Inspectors recommended an administrative complaint, which can lead to a fine, against ${names(complaints)}.`
      : n > 1 && mostCited && (mostCited.worst.total ?? 0) > 0
        ? `${md(mostCited.name)} was cited for the most violations, ${mostCited.worst.total} (${mostCited.worst.highPriority ?? 0} high priority).`
        : n === 1
          ? `${md(places[0]!.name)} was the only visit on file.`
          : `All ${n} met inspection standards.`;
  return {
    headline: `Restaurant inspections with a ${town.name} address, ${range}`,
    dek: `State inspectors visited ${count(n, 'food service establishment', 'food service establishments')}${withTrend(n, past)}${counts.length ? `; ${counts.join(' and ')}` : ''}.`,
    bodyMd: [
      `${lead} ${OUTSIDE_LIMITS}`,
      section('Ordered closed', closures, 'Closed until a follow-up visit finds them fixed.'),
      section(
        'Administrative complaint recommended',
        complaints,
        'Open while the complaint is decided.',
      ),
      section(
        'Warnings and follow-ups',
        warnings,
        'Given time to fix violations before a call-back.',
      ),
      passed.length
        ? ['## Met inspection standards', `${list(passed.map((p) => md(p.name)))}.`].join('\n\n')
        : null,
      `Each inspection is a snapshot of one visit. [Full histories](${INSPECTIONS_PAGE}).`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    beat: 'business',
    sourceRecordIds: inspections.map((r) => r.id),
  };
}

/** A "Label: value" line from an open-data record's text (lib/rows in the adapters). */
const labeled = (text: string | null, label: RegExp) =>
  (text ?? '')
    .split('\n')
    .map((l) => /^([^:]+): (.*)$/.exec(l))
    .find((m) => m && label.test(m[1]!))?.[2] ?? null;

const money = (value: string | null) => {
  const n = value ? Number(value.replace(/[$,]/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** How many permits the roundup lists by name; the rest are counted by type. */
const PERMITS_LISTED = 15;

/**
 * Last week's permits from a city or county open-data source (Socrata or ArcGIS), any town:
 * the largest by estimated cost with their address, type and contractor, then counts by type.
 * Owners' names never come through (the source's field map leaves them out). Tier 1 (§7).
 */
export function permitsRoundup(
  town: TownInfo,
  weekStart: Date,
  permits: TemplateRecord[],
  past?: number[],
): TemplatedDraft {
  const range = weekRange(town, weekStart);
  const rows = permits.map((p) => ({
    p,
    title: titleCase(p.title ?? 'Permit'),
    type: labeled(p.text, /^(type|permit type|application type)$/i),
    cost: money(labeled(p.text, /cost|valuation|value/i)),
    contractor: labeled(p.text, /^contractor/i),
  }));
  const byCost = [...rows].sort(
    (a, b) => (b.cost ?? 0) - (a.cost ?? 0) || a.title.localeCompare(b.title),
  );
  const listed = byCost.slice(0, PERMITS_LISTED);
  const total = rows.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  const byType = ranked(tally(rows, (r) => (r.type ? titleCase(r.type) : 'Other')));
  const top = byCost[0];
  const n = permits.length;
  return {
    headline: `Building permits in ${town.name}, ${range}`,
    dek: `${count(n, 'permit', 'permits')}${total > 0 ? ` worth an estimated ${usd(total)}` : ''}${withTrend(n, past)}${top?.cost ? `; the largest is ${top.title} (${usd(top.cost)})` : ''}.`,
    bodyMd: [
      [
        byType.length > 1 ? `${byType[0]![0]} permits led, ${byType[0]![1]} of ${n}.` : null,
        total > 0 ? 'Costs are the applicants’ estimates.' : null,
      ]
        .filter(Boolean)
        .join(' ') || null,
      `## ${listed.length < n ? `The ${listed.length} largest` : 'All permits'}`,
      listed
        .map((r) => {
          const parts = [
            r.cost ? `estimated cost ${usd(r.cost)}` : null,
            r.contractor ? `contractor ${md(titleCase(r.contractor))}` : null,
          ].filter(Boolean);
          const link = r.p.url ? ` [Record](${r.p.url})` : '';
          return `- **${md(r.title)}**${parts.length ? `: ${parts.join('; ')}.` : ''}${link}`;
        })
        .join('\n'),
      byType.length > 1
        ? ['## By type', byType.map(([t, k]) => `- ${md(t)}: ${k}`).join('\n')].join('\n\n')
        : null,
    ]
      .filter(Boolean)
      .join('\n\n'),
    beat: 'development',
    sourceRecordIds: permits.map((p) => p.id),
  };
}

/** How many sales the roundup lists by address; the rest are counted by kind of property. */
const SALES_LISTED = 10;

/** "1790899200000"-style dates are already days in the record text; this prints Oct. 2. */
const saleDay = (value: string | null, timeZone: string) => {
  const d = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : null;
  return d ? apDate(d, timeZone) : null;
};

/** County land-use names in plain words, singular and plural. */
const USE_WORDS: Record<string, [string, string]> = {
  'SINGLE FAMILY': ['single-family home', 'single-family homes'],
  CONDOMINIUM: ['condominium', 'condominiums'],
  TOWNHOUSE: ['townhouse', 'townhouses'],
  VACANT: ['vacant lot', 'vacant lots'],
  'MOBILE HOME/MANUFACTURED HOME': ['mobile home', 'mobile homes'],
};
const useWords = (use: string | null): [string, string] =>
  USE_WORDS[(use ?? '').toUpperCase()] ?? [
    (use ? titleCase(use) : 'other property').toLowerCase(),
    `${(use ? titleCase(use) : 'other property').toLowerCase()} sales`,
  ];

const medianOf = (values: number[]) => {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return 0;
  return v.length % 2 ? v[(v.length - 1) / 2]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2;
};

function saleRows(sales: TemplateRecord[], timeZone: string) {
  return sales
    .map((s) => ({
      s,
      address: titleCase(labeled(s.text, /^address$/i) ?? s.title ?? ''),
      price: money(labeled(s.text, /^price$/i)),
      use: labeled(s.text, /^use$/i),
      day: saleDay(labeled(s.text, /^sale date$/i), timeZone),
    }))
    .filter((r) => r.price !== null && r.address);
}

/**
 * A weekly roundup of property sales from the county property appraiser's records (owner,
 * 2026-10-17: "biggest home sales this week"). Built in code, Tier 1: addresses, prices and the
 * kind of property, never an owner's or buyer's name (the source never fetches them). Deeds are
 * recorded about two weeks after a sale, so the finder rounds up the week before last.
 */
export function propertySalesRoundup(
  town: TownInfo,
  weekStart: Date,
  sales: TemplateRecord[],
  past?: number[],
): TemplatedDraft {
  const range = weekRange(town, weekStart);
  const rows = saleRows(sales, town.timezone);
  const byPrice = [...rows].sort(
    (a, b) => b.price! - a.price! || a.address.localeCompare(b.address),
  );
  const listed = byPrice.slice(0, SALES_LISTED);
  const n = rows.length;
  const groups = new Map<string, { words: [string, string]; prices: number[] }>();
  for (const r of rows) {
    const words = useWords(r.use);
    const g = groups.get(words[0]) ?? { words, prices: [] };
    g.prices.push(r.price!);
    groups.set(words[0], g);
  }
  const mix = [...groups.values()]
    .sort((a, b) => b.prices.length - a.prices.length || a.words[0].localeCompare(b.words[0]))
    .map(
      (g) =>
        `${g.prices.length} ${g.prices.length === 1 ? g.words[0] : g.words[1]}${g.prices.length > 1 ? ` (median ${usd(medianOf(g.prices))})` : ''}`,
    );
  const top = byPrice[0];
  return {
    headline: `Property sales in ${town.name}, ${range}`,
    dek: top
      ? `${top.address} sold for ${usd(top.price!)}, the highest of ${count(n, 'sale', 'sales')} recorded${withTrend(n, past)}.`
      : `No sales were recorded${withTrend(0, past)}.`,
    bodyMd: [
      `The median price was ${usd(medianOf(rows.map((r) => r.price!)))}: ${list(mix)}. Deeds take about two weeks to record, so late filings may be missing.`,
      `## ${listed.length < n ? `The ${listed.length} highest prices` : 'Every sale'}`,
      listed
        .map((r) => {
          const parts = [usd(r.price!), useWords(r.use)[0], r.day].filter(Boolean);
          const link = r.s.url ? ` [Record](${r.s.url})` : '';
          return `- **${md(r.address)}**: ${parts.join(', ')}.${link}`;
        })
        .join('\n'),
    ].join('\n\n'),
    beat: 'development',
    sourceRecordIds: rows.map((r) => r.s.id),
  };
}

/**
 * A roundup's count in its own units, for comparing a week with the town's past weeks: places
 * (not licenses) for new places, establishments (not visits) for inspections, priced sales for
 * property sales, records for the rest.
 */
export function roundupUnits(kind: RoundupKind, recs: TemplateRecord[]): number {
  if (kind === 'new-places') return newPlaces(recs).length;
  if (kind === 'inspections') return inspectedPlaces(recs).length;
  if (kind === 'sales') return saleRows(recs, 'UTC').length;
  return recs.length;
}

type RoadWork = {
  project?: string;
  LOCATION?: string;
  DESCRIPTION?: string;
  RESTRICTION?: string;
  from?: string;
  to?: string;
};

/** "Military Trl." and "S. Military Trail" are one road. */
const ROAD_WORDS: Record<string, string> = {
  Trl: 'Trail',
  Rd: 'Road',
  Blvd: 'Boulevard',
  Ave: 'Avenue',
  St: 'Street',
  Hwy: 'Highway',
  Pkwy: 'Parkway',
  Dr: 'Drive',
};

/** "October 19, 2026" → "Oct. 19". */
const roadDay = (value: string | undefined, timeZone: string) => {
  const d = value ? new Date(`${value} 12:00 UTC`) : null;
  return d && !Number.isNaN(d.getTime()) ? apDate(d, timeZone) : null;
};

/**
 * Road work and lane closures (owner, 2026-10-17: road closures are content people share), from
 * a county's weekly construction list: one line per project in this town, closures first. Built
 * in code, Tier 1. Leads with this town's own count, its full closures and its busiest road.
 */
export function roadWorkRoundup(
  town: TownInfo,
  weekStart: Date,
  items: TemplateRecord[],
  past?: number[],
): TemplatedDraft {
  const rows = items.map((r) => {
    const raw = (r.raw ?? {}) as RoadWork;
    // Without the county's permit numbers ("UT73178-1225", "RW72642"), which mean nothing to readers.
    const restriction = (raw.RESTRICTION ?? '')
      .replace(/\s*\b[A-Z]{2}\d{4,6}(?:-\d{4})?\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      r,
      where: (r.title ?? raw.LOCATION ?? '').trim(),
      work: (raw.DESCRIPTION ?? '').replace(/\s+/g, ' ').trim().replace(/\.$/, ''),
      restriction,
      closed: /\bclosed\b|\bclosure of\b|detour/i.test(restriction),
    };
  });
  rows.sort((a, b) => Number(b.closed) - Number(a.closed) || a.where.localeCompare(b.where));
  const first = (items[0]?.raw ?? {}) as RoadWork;
  const from = roadDay(first.from, town.timezone);
  const to = roadDay(first.to, town.timezone);
  const range = from && to ? `${from}–${to}` : weekRange(town, weekStart);
  const n = rows.length;
  const closed = rows.filter((r) => r.closed);
  // The road named most often across this town's projects ("Military Trail", 4 projects).
  const roads = ranked(
    tally(rows, (r) => {
      const m =
        /([NSEW]\.\s)?([A-Z][\w.]*(?:\s[A-Z][\w.]*){0,2}\s(?:Trail|Trl\.|Road|Rd\.|Boulevard|Blvd\.|Avenue|Ave\.|Street|St\.|Highway|Hwy\.|Parkway|Pkwy\.|Drive|Dr\.|Way))/.exec(
          r.where,
        );
      return m
        ? m[2]!
            .replace(/^(N|S|E|W)\.\s/, '')
            .replace(/\b(\w+)\.$/, (w, abbr: string) => ROAD_WORDS[abbr] ?? w)
        : null;
    }),
  );
  const busiest = roads[0] && roads[0][1] > 1 ? roads[0] : null;
  const source = items.find((i) => i.url)?.url;
  return {
    headline: `Road work and lane closures in ${town.name}, ${range}`,
    dek: `${count(n, 'road project', 'road projects')} in ${town.name}${withTrend(n, past)}${closed.length ? `, ${count(closed.length, 'with a road closed or detoured', 'with roads closed or detoured')}` : ''}${busiest ? `; ${busiest[0]} has the most, ${busiest[1]}` : ''}.`,
    bodyMd: [
      closed.length
        ? `Plan around ${list(closed.slice(0, 3).map((c) => md(c.where)))} first.`
        : null,
      rows
        .map(
          (r) =>
            `- **${md(r.where)}**${r.work ? `: ${md(r.work)}.` : '.'}${r.restriction ? ` ${md(r.restriction)}` : ''}`,
        )
        .join('\n'),
      source ? `[The county's construction list](${source})` : null,
    ]
      .filter(Boolean)
      .join('\n\n'),
    beat: 'development',
    sourceRecordIds: items.map((i) => i.id),
  };
}

type Alert = {
  event?: string;
  headline?: string;
  description?: string;
  instruction?: string | null;
  severity?: string;
  messageType?: string;
  areaDesc?: string;
};

/** Alerts worth a story: moderate or worse, and not a cancellation. */
export function isNewsworthyAlert(raw: unknown): boolean {
  const alert = (raw ?? {}) as Alert;
  return (
    ['Moderate', 'Severe', 'Extreme'].includes(alert.severity ?? '') &&
    alert.messageType !== 'Cancel'
  );
}

/** A National Weather Service alert, quoted verbatim and attributed. */
export function weatherAlert(town: TownInfo, record: TemplateRecord): TemplatedDraft {
  const alert = (record.raw ?? {}) as Alert;
  const event = alert.event ?? record.title ?? 'Weather alert';
  const quote = (text: string) =>
    text
      .split(/\n\s*\n/)
      .map((p) => `> ${md(p.replace(/\s*\n\s*/g, ' ').trim())}`)
      .join('\n>\n');
  return {
    headline: `National Weather Service issues ${event} for the ${town.name} area`,
    dek: alert.headline ?? `${event} from the National Weather Service.`,
    bodyMd: [
      `The National Weather Service has issued a ${event}${alert.areaDesc ? ` for ${md(alert.areaDesc)}` : ''}. From the alert:`,
      quote(alert.description ?? record.text ?? ''),
      alert.instruction ? `What the Weather Service advises:\n\n${quote(alert.instruction)}` : null,
      record.url ? `[Read the full alert](${record.url})` : null,
    ]
      .filter(Boolean)
      .join('\n\n'),
    beat: 'community',
    sourceRecordIds: [record.id],
  };
}
