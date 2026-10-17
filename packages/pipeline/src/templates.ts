import {
  severityLevel,
  type NursingHomeInspection,
  type NursingHomePenalty,
} from '@towncore/adapters';
import { titleCase } from '@towncore/config';
import { apDate } from './time';

// Items built in code from structured records (CLAUDE.md §6 step 2: "templated jobs, not
// candidates"). No model writes them, so every fact is copied straight from a record; the
// tier router and publish rules still apply. Roundups link out to the official pages.
//
// The same template runs in thousands of towns, so each one leads with the town's own facts
// (the biggest item, the mix, how the week compares with the town's own past weeks) and keeps
// its fixed sentences to the few readers need (owner, 2026-10-17: no near-duplicates across
// towns; CI checks it in test/near-duplicate.test.ts). Never pad to vary the text.
//
// Every roundup reads like a short article, then gives the data (owner, 2026-10-17: "Roundups
// that read like articles"): a headline that leads with the most interesting fact, a lede of
// two or three sentences, "What stands out" ranked by each kind's own rules, the full data as a
// compact table that collapses after a dozen rows, and a line for readers only when there's a
// real place to go. Caveats about the data live with the sources ("About this data"), not in
// the body. A thin week stays a short item: no highlights, nothing stretched.

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
  | 'roads'
  | 'federal'
  | 'nursing-homes';

type TownInfo = { name: string; timezone: string; agency: string };

const byTime = (a: TemplateRecord, b: TemplateRecord) =>
  (a.occurredAt?.getTime() ?? 0) - (b.occurredAt?.getTime() ?? 0);

// Markdown-escape text that came from a record (names can contain * _ [ ] |).
export const md = (s: string) => s.replace(/([\\*_[\]`<>|])/g, '\\$1');

/** "Oct. 5–11", or "Sept. 28–Oct. 4" across a month end. */
export function dayRange(from: Date, to: Date, timeZone: string): string {
  const a = apDate(from, timeZone);
  const b = apDate(to, timeZone);
  const [monthA] = a.split(' ');
  const [monthB, dayB] = b.split(' ');
  return monthA === monthB ? `${a}–${dayB}` : `${a}–${b}`;
}

const weekRange = (town: TownInfo, weekStart: Date) =>
  dayRange(weekStart, new Date(weekStart.getTime() + 6 * 86_400_000), town.timezone);

export const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** "a, b and c". */
export const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** "3 limited liability companies": a count with its noun, singular or plural. */
export const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
/** AP style: one to nine in words, 10 and up in figures. */
export const numWord = (n: number) => (n >= 0 && n < 10 ? WORDS[n]! : String(n));
/** "a brewery", "two dental practices", "12 shops". */
const counted = (n: number, [one, many]: readonly [string, string]) =>
  n === 1 ? `${/^[aeiou]/i.test(one) ? 'an' : 'a'} ${one}` : `${numWord(n)} ${many}`;
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "2 other businesses", "one other business". */
const others = (n: number, one: string, many: string) =>
  `${numWord(n)} other ${n === 1 ? one : many}`;

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

/** Up to `max` names, then "and N more". */
const someNames = (names: string[], max = 4) =>
  names.length <= max
    ? list(names)
    : `${names.slice(0, max).join(', ')} and ${names.length - max} more`;

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

/** "That's up from 76 the week before." Null without past weeks. */
const trendSentence = (n: number, past?: number[]) => {
  const t = weekTrend(n, past);
  return t ? `That's ${t}.` : null;
};

// --- The shared roundup layout ---------------------------------------------------------------

/** A week with this many items or fewer is a short item: lede and data, no highlights. */
export const THIN_WEEK = 5;
/** Tables longer than this show their first SHOWN_ROWS rows, then "Show all". */
export const COLLAPSE_OVER = 15;
export const SHOWN_ROWS = 12;
/** "What stands out" lists at most this many items. */
export const MAX_HIGHLIGHTS = 5;

export type RoundupTable = {
  head: string[];
  /** Cells in Markdown, already escaped. */
  rows: string[][];
  /** What one row is, singular and plural ("filing", "filings"). */
  noun: readonly [string, string];
};

const row = (cells: string[]) => `| ${cells.map((c) => c.replace(/\n/g, ' ')).join(' | ')} |`;

/**
 * The full data as a pipe table (the site renders it in its own scrolling box). A long table
 * shows its first rows, then the rest inside a closed `:::details` block ("Show all 101
 * filings"), so every row stays in the page without a wall of text.
 */
export function dataTable(t: RoundupTable): string {
  const header = [row(t.head), row(t.head.map(() => '---'))];
  if (t.rows.length <= COLLAPSE_OVER) return [...header, ...t.rows.map(row)].join('\n');
  return [
    [...header, ...t.rows.slice(0, SHOWN_ROWS).map(row)].join('\n'),
    `:::details Show all ${t.rows.length} ${t.noun[1]}`,
    [...header, ...t.rows.slice(SHOWN_ROWS).map(row)].join('\n'),
    ':::',
  ].join('\n');
}

export type RoundupParts = {
  /** Two or three sentences built from the records; nulls are dropped. */
  lede: (string | null)[];
  /** Ranked by the kind's own rules; shown only on a full week with at least two. */
  highlights?: string[];
  /** The data's heading on a full week ("All 101 filings"). */
  dataTitle?: string;
  data?: string;
  /** "What it means for readers": only when there's somewhere real to send them. */
  readers?: string | null;
  thin?: boolean;
};

/** The one structure every code-built roundup follows. */
export function roundupBody(p: RoundupParts): string {
  // A sentence that ends on a name like "Example, INC." keeps one period.
  const end = (s: string) => s.replace(/\.\.$/, '.');
  const highlights = p.thin ? [] : (p.highlights ?? []).slice(0, MAX_HIGHLIGHTS).map(end);
  return [
    p.lede
      .filter((s): s is string => Boolean(s))
      .map(end)
      .join(' '),
    highlights.length >= 2
      ? ['## What stands out', highlights.map((h) => `- ${h}`).join('\n')].join('\n\n')
      : null,
    p.data && p.dataTitle && !p.thin ? `## ${p.dataTitle}` : null,
    p.data ?? null,
    p.readers ?? null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

// --- Meetings --------------------------------------------------------------------------------

/** Governing bodies first, then boards that decide land use and money, then the rest. */
function meetingWeight(title: string): number {
  if (
    /\b(city|town|village|county) (commission|council)\b|\bboard of (county )?(commissioners|aldermen|selectmen|trustees)\b|\bselect ?board\b|^(city |town )?(commission|council)\b/i.test(
      title,
    )
  )
    return 3;
  if (/planning|zoning|development|redevelopment|\bCRA\b|budget|finance|code|historic/i.test(title))
    return 2;
  return 1;
}

/** "City Commission Regular Meeting" → "City Commission". */
const meetingBody = (title: string) =>
  title.replace(/\s+(regular|special|workshop)?\s*meeting$/i, '').trim() || title;

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
  const rows = sorted.map((m) => {
    const lines = Object.fromEntries(
      (m.text ?? '')
        .split('\n')
        .map((line) => line.match(/^(When|Where): (.*)$/))
        .filter((x): x is RegExpMatchArray => x !== null)
        .map((x) => [x[1], x[2]]),
    ) as { When?: string; Where?: string };
    const title = m.title ?? 'Meeting';
    return { m, title, when: lines.When ?? null, where: lines.Where ?? null };
  });
  const items = rows.map((r) => {
    const details = [r.when, r.where]
      .filter(Boolean)
      .map((p) => md(p!))
      .join('; ');
    const end = details && !details.endsWith('.') ? '.' : '';
    const link = r.m.url ? ` [Agenda and details](${r.m.url})` : '';
    return `- **${md(r.title)}**: ${details}${end}${link}`;
  });
  const n = rows.length;
  // The meeting with the widest reach leads; ties go to the earliest.
  const byWeight = [...rows].sort((a, b) => meetingWeight(b.title) - meetingWeight(a.title));
  const top = byWeight[0];
  const day = (r: (typeof rows)[number]) =>
    r.m.occurredAt
      ? `${weekday(r.m.occurredAt)}, ${apDate(r.m.occurredAt, town.timezone)}`
      : (r.when ?? '');
  const meets = (r: (typeof rows)[number]) =>
    `${md(meetingBody(r.title))} meets ${md(r.when ?? day(r))}${r.where ? ` at ${md(r.where)}` : ''}`;
  const byDay = tally(sorted, (m) => (m.occurredAt ? weekday(m.occurredAt) : null));
  const [busiest] = ranked(byDay);
  const busiestTitles = busiest
    ? rows
        .filter((r) => r.m.occurredAt && weekday(r.m.occurredAt) === busiest[0])
        .map((r) => md(meetingBody(r.title)))
    : [];
  const busiestLine =
    busiest && busiest[1] > 1 && byDay.size > 1
      ? `${busiest[0]} is the busiest day: ${list(busiestTitles)}.`
      : null;
  const thin = n <= THIN_WEEK;
  return {
    headline: top
      ? n === 1
        ? `${meetingBody(top.title)} meets ${day(top)} in ${town.name}`
        : `${meetingBody(top.title)} meets ${day(top)}, one of ${n} public meetings in ${town.name}`
      : `Public meetings in ${town.name}, ${range}`,
    dek:
      n === 1
        ? `The only public meeting on the ${town.agency} calendar, ${range}.`
        : `${count(n, 'public meeting', 'public meetings')} on the ${town.agency} calendar, ${range}.`,
    bodyMd: roundupBody({
      thin,
      lede: [top ? `${meets(top)}.` : null, trendSentence(n, past), busiestLine],
      highlights: byWeight
        .filter((r) => meetingWeight(r.title) >= 2 && r !== top)
        .slice(0, 4)
        .map((r) => `${meets(r)}.`),
      dataTitle: 'Every meeting',
      data:
        items.length > COLLAPSE_OVER
          ? [
              items.slice(0, SHOWN_ROWS).join('\n'),
              `:::details Show all ${n} meetings`,
              items.slice(SHOWN_ROWS).join('\n'),
              ':::',
            ].join('\n')
          : items.join('\n'),
    }),
    beat: 'government',
    sourceRecordIds: meetings.map((m) => m.id),
  };
}

// --- New businesses --------------------------------------------------------------------------

type Filing = {
  name?: string;
  number?: string;
  fileDate?: string;
  zip?: string;
  address1?: string;
};

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

/**
 * Kinds of business read from a company's name (filings don't say what a company does; the
 * sources box says so). `visit`: a place readers can walk into. `dir`: its directory category.
 * Order matters: the first match wins, and visitable kinds rank in this order.
 */
export const NAME_KINDS: ReadonlyArray<{
  re: RegExp;
  words: readonly [string, string];
  visit: boolean;
  dir?: string;
  food?: boolean;
}> = [
  {
    re: /\bBREW(ING|ERY|ERIES|PUB|HOUSE)\b/,
    words: ['brewery', 'breweries'],
    visit: true,
    dir: 'bars-and-nightlife',
    food: true,
  },
  {
    re: /\b(RESTAURANTS?|PIZZA|PIZZERIA|GRILL|SUSHI|TACOS?|TAQUERIA|BISTRO|EATERY|DINER|BBQ|BARBECUE|BURGERS?|TRATTORIA|STEAKHOUSE|CANTINA|RAMEN)\b/,
    words: ['restaurant', 'restaurants'],
    visit: true,
    dir: 'restaurants',
    food: true,
  },
  {
    re: /\b(CAFE|CAFÉ|COFFEE|ESPRESSO|BAKERY|BAKESHOP|BAGELS?|DONUTS?|PATISSERIE)\b/,
    words: ['café or bakery', 'cafés or bakeries'],
    visit: true,
    dir: 'coffee-and-bakeries',
    food: true,
  },
  {
    re: /\b(DENTAL|DENTISTRY|DENTIST|ORTHODONTICS?)\b/,
    words: ['dental practice', 'dental practices'],
    visit: true,
    dir: 'health-and-medical',
  },
  {
    re: /\b(SALON|NAILS?|BARBER(SHOP)?|(?<!POOLS? (AND|&) )SPA|LASH(ES)?|BROWS?|BEAUTY|AESTHETICS?)\b/,
    words: ['salon or spa', 'salons or spas'],
    visit: true,
    dir: 'beauty-and-wellness',
  },
  {
    re: /\b(FITNESS|GYM|YOGA|PILATES|CROSSFIT|KARATE|MARTIAL ARTS)\b/,
    words: ['gym or fitness studio', 'gyms or fitness studios'],
    visit: true,
    dir: 'fitness',
  },
  {
    re: /\b(BOUTIQUE|JEWEL(L)?ERS?|JEWELRY|FLORIST|GALLERY|MARKET)\b/,
    words: ['shop', 'shops'],
    visit: true,
    dir: 'shopping',
  },
  {
    re: /\b(MEDICAL|CLINIC|PHYSICIANS?|CHIROPRACTIC|PEDIATRICS?|DERMATOLOGY|PHARMACY|VETERINARY|ANIMAL HOSPITAL)\b/,
    words: ['medical practice', 'medical practices'],
    visit: true,
    dir: 'health-and-medical',
  },
  {
    re: /\b(REALTY|REAL ESTATE|REALTORS?)\b/,
    words: ['real estate business', 'real estate businesses'],
    visit: false,
  },
  {
    re: /\b(ROOFING|PLUMBING|ELECTRIC(AL)?|HVAC|AIR CONDITIONING|POOLS?|PAINTING|CONSTRUCTION|BUILDERS|CONTRACTING|LANDSCAPING|LAWN|CLEANING|REMODEL(ING)?|HANDYMAN)\b/,
    words: ['home services company', 'home services companies'],
    visit: false,
  },
  {
    re: /\b(HOLDINGS?|INVESTMENTS?|CAPITAL|VENTURES?|EQUITY|ASSETS?|PROPERTIES)\b/,
    words: ['holding or investment company', 'holding or investment companies'],
    visit: false,
  },
  {
    re: /\b(CONSULTING|CONSULTANTS?|MARKETING|MEDIA|SOFTWARE|TECHNOLOG(Y|IES))\b/,
    words: ['consulting, media or tech firm', 'consulting, media or tech firms'],
    visit: false,
  },
  {
    re: /\b(TRUCKING|LOGISTICS|TRANSPORT(ATION)?|FREIGHT|MOVING)\b/,
    words: ['transport company', 'transport companies'],
    visit: false,
  },
];

/** The kind of business a name points to, or null. */
export function nameKind(name: string) {
  const upper = name.toUpperCase();
  return NAME_KINDS.find((k) => k.re.test(upper)) ?? null;
}

/** "1200 N Federal Hwy Ste 4" → "N Federal Hwy": the street without the number or unit. */
const streetName = (address: string | undefined) => {
  const m = /^\s*\d+[A-Z]?\s+(.+?)(?:,|\s+(?:STE|SUITE|UNIT|APT|#|BLDG|PH)\b|$)/i.exec(
    address ?? '',
  );
  return m ? titleCase(m[1]!.trim()) : null;
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
      const type = filingKind(f.text?.match(/^(.*?), document number/)?.[1] ?? 'Filing');
      const filed = mdyToAp(f.text?.match(/, filed (\d{2}\/\d{2}\/\d{4})\./)?.[1], town.timezone);
      // Principal addresses are often homes: the ZIP code only, and a street only as a count.
      const zip = raw.zip?.slice(0, 5) ?? null;
      const name = titleCase(f.title ?? raw.name ?? '');
      return { name, type, filed, zip, kind: nameKind(name), street: streetName(raw.address1) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const n = rows.length;
  const thin = n <= THIN_WEEK;
  const types = ranked(tally(rows, (r) => r.type[0]));
  const plurals = new Map(rows.map((r) => [r.type[0], r.type[1]]));
  const mix = types.map(([k, c]) => `${c} ${c === 1 ? k : plurals.get(k)}`);
  // Kinds by name, in NAME_KINDS order for places people can visit, then by size.
  const kinds = NAME_KINDS.map((k) => ({ k, rows: rows.filter((r) => r.kind === k) })).filter(
    (g) => g.rows.length,
  );
  const visit = kinds.filter((g) => g.k.visit);
  const biggest = [...kinds].sort((a, b) => b.rows.length - a.rows.length)[0];
  const [topZip] = ranked(tally(rows, (r) => r.zip));
  const [topStreet] = ranked(tally(rows, (r) => r.street));
  const outOfState = rows.filter((r) => r.type[0].startsWith('out-of-state'));
  const nonprofits = rows.filter((r) => /nonprofit/.test(r.type[0]));
  const nameList = (rs: typeof rows) => someNames(rs.map((r) => md(r.name)));

  // Headline: places people can visit lead, then the biggest kind by name, then names.
  const lead = visit.length
    ? visit.slice(0, 2)
    : biggest && biggest.rows.length > 1
      ? [biggest]
      : [];
  const leadCount = lead.reduce((s, g) => s + g.rows.length, 0);
  const rest = n - leadCount;
  const where = `with a ${town.name} address`;
  const headline = lead.length
    ? `${cap(list([...lead.map((g) => counted(g.rows.length, g.k.words)), ...(rest ? [others(rest, 'business', 'businesses')] : [])]))} registered ${where}`
    : n <= 2
      ? `${list(rows.map((r) => r.name))} registered ${where}`
      : `${rows[0]!.name}, ${rows[1]!.name} and ${others(n - 2, 'business', 'businesses')} registered ${where}`;

  return {
    headline,
    dek: `${count(n, 'new business', 'new businesses')} filed with the state with a ${town.name} mailing address, ${range}.`,
    bodyMd: roundupBody({
      thin,
      lede: [
        trendSentence(n, past),
        types.length > 1 ? `By filing type: ${list(mix)}.` : null,
        visit.length
          ? `Among them by name: ${list(
              visit.slice(0, 2).map(
                (g) =>
                  `${counted(g.rows.length, g.k.words)} (${someNames(
                    g.rows.map((r) => md(r.name)),
                    2,
                  )})`,
              ),
            )}.`
          : biggest && biggest.rows.length > 1
            ? `By name, the largest group is ${biggest.k.words[1]}, ${biggest.rows.length} of ${n}.`
            : null,
      ],
      highlights: [
        // Places people can visit beyond the two the headline names.
        visit.length > 2
          ? `Also by name: ${list(visit.slice(2).map((g) => `${counted(g.rows.length, g.k.words)} (${nameList(g.rows)})`))}.`
          : null,
        topStreet && topStreet[1] >= 3
          ? `${topStreet[1]} list an address on ${md(topStreet[0])}.`
          : null,
        topZip && topZip[1] > 1 && tally(rows, (r) => r.zip).size > 1
          ? `ZIP code ${topZip[0]} had the most filings, ${topZip[1]}.`
          : null,
        outOfState.length
          ? `${cap(counted(outOfState.length, ['is an out-of-state company', 'are out-of-state companies']))} registering to do business in the state.`
          : null,
        nonprofits.length
          ? `${cap(counted(nonprofits.length, ['nonprofit', 'nonprofits']))}: ${nameList(nonprofits)}.`
          : null,
        ...kinds
          .filter((g) => !g.k.visit && g.rows.length > 1)
          .map((g) => `${g.rows.length} names read as ${g.k.words[1]}.`),
      ].filter((h): h is string => h !== null),
      dataTitle: `All ${count(n, 'filing', 'filings')}`,
      data: dataTable({
        head: ['Business', 'Type', 'ZIP', 'Filed'],
        rows: rows.map((r) => [md(r.name), r.type[0], r.zip ?? '', r.filed ?? '']),
        noun: ['filing', 'filings'],
      }),
      readers: (() => {
        const food = visit.filter((g) => g.k.food).reduce((s, g) => s + g.rows.length, 0);
        return food
          ? `Places to eat need a state food license before they open; [the directory](/directory/restaurants) lists them as licenses arrive.`
          : null;
      })(),
    }),
    beat: 'business',
    sourceRecordIds: filings.map((f) => f.id),
  };
}

// --- New contractor licenses -----------------------------------------------------------------

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

/** A trade's directory category, for the readers line. */
const TRADE_DIRECTORY: Array<[RegExp, string, string]> = [
  [/general|building|residential/i, 'general-contractors', 'general contractors'],
  [/roof/i, 'roofers', 'roofers'],
  [/electric/i, 'electricians', 'electricians'],
  [/plumb/i, 'plumbers', 'plumbers'],
  [/air conditioning|mechanical|hvac/i, 'hvac', 'air conditioning contractors'],
  [/pool|spa/i, 'pool-and-spa', 'pool and spa contractors'],
  [/solar/i, 'solar', 'solar contractors'],
  [/alarm/i, 'alarm-systems', 'alarm contractors'],
];

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
  const n = rows.length;
  const thin = n <= THIN_WEEK;
  const trades = ranked(tally(rows, (r) => r.occupation?.toLowerCase() ?? null));
  const words = (o: string): [string, string] => [o, `${o}s`];
  const [t1, t2] = trades;
  const leadCount = (t1?.[1] ?? 0) + (t2?.[1] ?? 0);
  const headline = t1
    ? `${cap(list([t1, t2].filter((t): t is [string, number] => !!t).map(([o, c]) => counted(c, words(o)))))}${n - leadCount ? ` and ${others(n - leadCount, 'contractor', 'contractors')}` : ''} licensed with a ${town.name} address`
    : `${count(n, 'contractor', 'contractors')} licensed with a ${town.name} address`;
  const dir = t1 ? TRADE_DIRECTORY.find(([re]) => re.test(t1[0])) : undefined;
  return {
    headline,
    dek: `${count(n, 'first state license', 'first state licenses')} for contractors with a ${town.name} mailing address, ${range}.`,
    bodyMd: roundupBody({
      thin,
      lede: [
        trendSentence(n, past),
        trades.length > 1
          ? `By trade: ${list(trades.map(([o, c]) => `${c} ${c === 1 ? o : `${o}s`}`))}.`
          : null,
      ],
      highlights: trades.map(([o, c]) => {
        const names = rows.filter((r) => r.occupation?.toLowerCase() === o).map((r) => md(r.name));
        return `${cap(counted(c, words(o)))}: ${someNames(names, 3)}.`;
      }),
      dataTitle: `All ${count(n, 'license', 'licenses')}`,
      data: dataTable({
        head: ['Business', 'Trade', 'License'],
        rows: rows.map((r) => [md(r.name), md(r.occupation ?? ''), md(r.license ?? '')]),
        noun: ['license', 'licenses'],
      }),
      readers: dir ? `The directory lists licensed [${dir[2]}](/directory/${dir[1]}).` : null,
    }),
    beat: 'business',
    sourceRecordIds: licenses.map((l) => l.id),
  };
}

// --- New places to eat and drink -------------------------------------------------------------

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

export type Place = {
  name: string;
  street: string;
  notes: string[];
  kinds: string[];
  ids: string[];
};

/**
 * New places from new food service and liquor licenses, one per place (a place's food and liquor
 * licenses merge). Named by trade name, or the license holder only when that is a company.
 */
export function newPlaces(items: TemplateRecord[]): Place[] {
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

/** Places with seating rank first, then those that also got a liquor license, then the rest. */
const placeWeight = (p: Place) =>
  (p.kinds.includes('restaurant with seating') ? 2 : 0) +
  (p.kinds.includes('liquor license') ? 1 : 0);

/**
 * New places to eat and drink (owner, 2026-10-17): new food service establishments the state
 * approved and new alcoholic beverage licenses, the same week, one row per place. Built in code,
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
  const thin = n <= THIN_WEEK;
  const kindCounts = ranked(
    tally(
      rows.flatMap((r) => r.kinds),
      (k) => k,
    ),
  );
  const mix = kindCounts.map(([k, c]) => `${c} ${c === 1 ? k : (PLACE_PLURALS[k] ?? k)}`);
  const top = [...rows].sort(
    (a, b) => placeWeight(b) - placeWeight(a) || a.name.localeCompare(b.name),
  );
  const named = top.slice(0, 2).map((r) => r.name);
  const both = top.filter((p) => p.kinds.length > 1 && p.kinds.includes('liquor license'));
  const of = (kind: string) => top.filter((p) => p.kinds.includes(kind));
  const seated = of('restaurant with seating');
  const [topStreet] = ranked(tally(rows, (r) => streetName(r.street)));
  const where = `with a ${town.name} address`;
  return {
    headline:
      n === 1
        ? `${named[0]} gets state approval to serve food or drink ${where}`
        : n === 2
          ? `${list(named)} get state approval to serve food or drink ${where}`
          : `${named.join(', ')} and ${others(n - 2, 'place', 'places')} get approval to serve food or drink ${where}`,
    dek: `${count(n, 'new place', 'new places')} to eat or drink got state approval, ${range}.`,
    bodyMd: roundupBody({
      thin,
      lede: [
        trendSentence(n, past),
        `By license: ${list(mix)}.`,
        both[0]
          ? `${md(both[0].name)}${both[0].street ? `, at ${md(both[0].street)},` : ''} got both a food service license and a liquor license.`
          : null,
      ],
      highlights: [
        seated.length
          ? `${cap(counted(seated.length, ['restaurant with seating', 'restaurants with seating']))}: ${someNames(seated.map((p) => md(p.name)))}.`
          : null,
        of('liquor license').length
          ? `${cap(counted(of('liquor license').length, ['new liquor license', 'new liquor licenses']))}: ${someNames(of('liquor license').map((p) => md(p.name)))}.`
          : null,
        topStreet && topStreet[1] >= 2
          ? `${cap(numWord(topStreet[1]))} are on ${md(topStreet[0])}: ${list(rows.filter((r) => streetName(r.street) === topStreet[0]).map((r) => md(r.name)))}.`
          : null,
        of('food truck').length
          ? `${cap(counted(of('food truck').length, ['food truck', 'food trucks']))}: ${someNames(of('food truck').map((p) => md(p.name)))}.`
          : null,
        of('caterer').length
          ? `${cap(counted(of('caterer').length, ['caterer', 'caterers']))}: ${someNames(of('caterer').map((p) => md(p.name)))}.`
          : null,
      ].filter((h): h is string => h !== null),
      dataTitle: `All ${count(n, 'place', 'places')}`,
      data: dataTable({
        head: ['Place', 'Street', 'Approved for'],
        rows: top.map((r) => [md(r.name), md(r.street), md(r.notes.join('; '))]),
        noun: ['place', 'places'],
      }),
      readers: seated.length
        ? `${cap(numWord(seated.length))} of these ${seated.length === 1 ? 'is a restaurant' : 'are restaurants'} with seating; [the directory](/directory/restaurants) lists places to eat.`
        : null,
    }),
    beat: 'business',
    sourceRecordIds: rows.flatMap((r) => r.ids),
  };
}

// --- Restaurant inspections ------------------------------------------------------------------

export type Inspection = {
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

export const SEVERITY_RANK = { ok: 0, warning: 1, complaint: 2, closure: 3 } as const;
const RESULT_WORDS = {
  closure: 'Ordered closed',
  complaint: 'Complaint recommended',
  warning: 'Warning',
  ok: 'Met standards',
} as const;

/** True when any inspection in the list led to a closure order or an administrative complaint. */
export function hasInspectionFailures(raws: unknown[]): boolean {
  return raws.some((r) => {
    const s = ((r ?? {}) as Inspection).severity;
    return s === 'closure' || s === 'complaint';
  });
}

export const INSPECTIONS_PAGE =
  'https://www2.myfloridalicense.com/hotels-restaurants/public-records/';

/** MM/DD/YYYY sort key. */
export const mdy = (d: string | undefined) =>
  (d ?? '').replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3$1$2');

/** Inspection visits grouped by establishment, each judged by its most serious visit. */
export function inspectedPlaces(inspections: TemplateRecord[]) {
  const groups = new Map<string, Inspection[]>();
  const ids = new Map<string, string[]>();
  for (const r of inspections) {
    const raw = (r.raw ?? {}) as Inspection;
    const key = raw.licenseNumber || raw.business || r.id;
    groups.set(key, [...(groups.get(key) ?? []), raw]);
    ids.set(key, [...(ids.get(key) ?? []), r.id]);
  }
  return [...groups].map(([key, visits]) => {
    const sorted = [...visits].sort((a, b) => mdy(a.date).localeCompare(mdy(b.date)));
    const worst = sorted.reduce((w, v) =>
      SEVERITY_RANK[v.severity ?? 'ok'] > SEVERITY_RANK[w.severity ?? 'ok'] ? v : w,
    );
    const latest = sorted.at(-1)!;
    const fixedLater =
      (worst.severity ?? 'ok') !== 'ok' &&
      worst !== latest &&
      (latest.severity ?? 'ok') === 'ok' &&
      mdy(latest.date) > mdy(worst.date)
        ? latest.date
        : null;
    return {
      key,
      name: titleCase(worst.business ?? ''),
      worst,
      latest,
      fixedLater,
      ids: ids.get(key)!,
    };
  });
}

/**
 * Last week's state food service inspections (Florida DBPR), one row per establishment under
 * its most serious result that week: the visit's date, violation counts and, when a later
 * call-back the same week found the problems fixed, that too. Closures and complaints lead. A
 * week with any closure or complaint goes to review (Tier 3, §7), since it names businesses.
 */
export function inspectionsRoundup(
  town: TownInfo,
  weekStart: Date,
  inspections: TemplateRecord[],
  past?: number[],
): TemplatedDraft {
  const range = weekRange(town, weekStart);
  const places = inspectedPlaces(inspections).sort(
    (a, b) =>
      SEVERITY_RANK[b.worst.severity ?? 'ok'] - SEVERITY_RANK[a.worst.severity ?? 'ok'] ||
      (b.worst.highPriority ?? 0) - (a.worst.highPriority ?? 0) ||
      a.name.localeCompare(b.name),
  );
  const by = (sev: keyof typeof SEVERITY_RANK) =>
    places.filter((p) => (p.worst.severity ?? 'ok') === sev);
  const closures = by('closure');
  const complaints = by('complaint');
  const warnings = by('warning');
  const passed = by('ok');
  const n = places.length;
  // A closure or complaint is always worth its own line, however few places were visited.
  const thin = n <= THIN_WEEK && !closures.length && !complaints.length;
  const names = (group: typeof places) => list(group.map((p) => md(p.name)));
  const detail = (p: (typeof places)[number]) => {
    const v = p.worst;
    const parts = [
      v.address ? md(titleCase(v.address)) : null,
      v.date ? `inspected ${v.date}${(v.visit ?? 1) > 1 ? ' (call-back visit)' : ''}` : null,
      `${v.total ?? 0} ${v.total === 1 ? 'violation' : 'violations'}, ${v.highPriority ?? 0} high priority`,
      p.fixedLater ? `a call-back visit on ${p.fixedLater} found it in compliance` : null,
    ].filter(Boolean);
    return `**${md(p.name)}**: ${parts.join('; ')}.`;
  };
  const mostCited = [...places].sort(
    (a, b) =>
      (b.worst.highPriority ?? 0) - (a.worst.highPriority ?? 0) ||
      (b.worst.total ?? 0) - (a.worst.total ?? 0),
  )[0];
  const cited = mostCited && (mostCited.worst.total ?? 0) > 0 ? mostCited : null;
  const lead = closures.length
    ? `Inspectors ordered ${names(closures)} closed until a follow-up visit finds the problems fixed.`
    : complaints.length
      ? `Inspectors recommended an administrative complaint, which can lead to a fine, against ${names(complaints)}.`
      : n > 1 && cited
        ? `${md(cited.name)} was cited for the most violations, ${cited.worst.total} (${cited.worst.highPriority ?? 0} high priority).`
        : n === 1
          ? `${md(places[0]!.name)} was the only visit on file.`
          : `All ${n} met inspection standards.`;
  const where = `with a ${town.name} address`;
  const headline = closures.length
    ? `Inspectors order ${list(closures.map((p) => p.name))} closed; ${n} places inspected ${where}`
    : complaints.length
      ? `Inspectors recommend a complaint against ${list(complaints.map((p) => p.name))}; ${n} places inspected ${where}`
      : !passed.length || passed.length < n
        ? cited
          ? `${cited.name} cited for ${count(cited.worst.total ?? 0, 'violation', 'violations')} among ${count(n, 'place', 'places')} inspected ${where}`
          : `${count(n, 'place', 'places')} inspected ${where}`
        : n === 1
          ? `${places[0]!.name} meets inspection standards ${where}`
          : `All ${n} places inspected ${where} met standards`;
  return {
    headline,
    dek: `State inspectors visited ${count(n, 'food service establishment', 'food service establishments')}, ${range}.`,
    bodyMd: roundupBody({
      thin,
      lede: [
        lead,
        trendSentence(n, past),
        passed.length && passed.length < n
          ? `${passed.length === 1 ? 'One' : passed.length} met inspection standards.`
          : null,
      ],
      highlights: [
        ...closures.map(detail),
        ...complaints.map(detail),
        ...warnings.slice(0, 3).map(detail),
      ],
      dataTitle: `All ${count(n, 'place', 'places')} inspected`,
      data: dataTable({
        head: ['Establishment', 'Result', 'Inspected', 'Violations (high priority)'],
        rows: places.map((p) => [
          md(p.name),
          `${RESULT_WORDS[p.worst.severity ?? 'ok']}${p.fixedLater ? `; in compliance ${p.fixedLater}` : ''}`,
          p.worst.date ?? '',
          `${p.worst.total ?? 0} (${p.worst.highPriority ?? 0})`,
        ]),
        noun: ['place', 'places'],
      }),
      readers:
        closures.length || complaints.length || warnings.length
          ? `[Full inspection histories](${INSPECTIONS_PAGE}) are on the state's site.`
          : null,
    }),
    beat: 'business',
    sourceRecordIds: inspections.map((r) => r.id),
  };
}

// --- Permits ---------------------------------------------------------------------------------

/** A "Label: value" line from an open-data record's text (lib/rows in the adapters). */
export const labeled = (text: string | null, label: RegExp) =>
  (text ?? '')
    .split('\n')
    .map((l) => /^([^:]+): (.*)$/.exec(l))
    .find((m) => m && label.test(m[1]!))?.[2] ?? null;

export const money = (value: string | null) => {
  const n = value ? Number(value.replace(/[$,]/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

export const linked = (text: string, url: string | null) => (url ? `[${text}](${url})` : text);

/** Permits with the fields the roundup and spotlights read. */
export function permitRows(permits: TemplateRecord[]) {
  return permits.map((p) => ({
    p,
    title: titleCase(p.title ?? 'Permit'),
    type: labeled(p.text, /^(type|permit type|application type)$/i),
    cost: money(labeled(p.text, /cost|valuation|value/i)),
    contractor: labeled(p.text, /^contractor/i),
    work: labeled(p.text, /^(work|description)$/i),
    address: labeled(p.text, /^address$/i),
    status: labeled(p.text, /^status$/i),
  }));
}

/**
 * Last week's permits from a city or county open-data source (Socrata or ArcGIS), any town:
 * the biggest projects by estimated cost lead, then every permit in a table. Owners' names never
 * come through (the source's field map leaves them out). Tier 1 (§7).
 */
export function permitsRoundup(
  town: TownInfo,
  weekStart: Date,
  permits: TemplateRecord[],
  past?: number[],
): TemplatedDraft {
  const range = weekRange(town, weekStart);
  const rows = permitRows(permits);
  const byCost = [...rows].sort(
    (a, b) => (b.cost ?? 0) - (a.cost ?? 0) || a.title.localeCompare(b.title),
  );
  const total = rows.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  const byType = ranked(tally(rows, (r) => (r.type ? titleCase(r.type) : 'Other')));
  const top = byCost[0];
  const n = permits.length;
  const thin = n <= THIN_WEEK;
  return {
    headline: top?.cost
      ? `${top.title} (${usd(top.cost)}) is the largest of ${count(n, 'permit', 'permits')} in ${town.name}`
      : `${count(n, 'building permit', 'building permits')} in ${town.name}, ${range}`,
    dek: `${count(n, 'permit', 'permits')}${total > 0 ? ` worth an estimated ${usd(total)}` : ''}, ${range}.`,
    bodyMd: roundupBody({
      thin,
      lede: [
        trendSentence(n, past),
        byType.length > 1 ? `${md(byType[0]![0])} permits led, ${byType[0]![1]} of ${n}.` : null,
        total > 0 ? 'Costs are the applicants’ estimates.' : null,
      ],
      highlights: byCost
        .filter((r) => r.cost)
        .slice(0, 3)
        .map(
          (r) =>
            `**${linked(md(r.title), r.p.url)}**: estimated ${usd(r.cost!)}${r.contractor ? `, contractor ${md(titleCase(r.contractor))}` : ''}.`,
        )
        .concat(
          byType.length > 1 ? [`By type: ${list(byType.map(([t, k]) => `${md(t)} ${k}`))}.`] : [],
        ),
      dataTitle: `All ${count(n, 'permit', 'permits')}, largest first`,
      data: dataTable({
        head: ['Permit', 'Type', 'Estimated cost', 'Contractor'],
        rows: byCost.map((r) => [
          linked(md(r.title), r.p.url),
          md(r.type ? titleCase(r.type) : ''),
          r.cost ? usd(r.cost) : '',
          md(r.contractor ? titleCase(r.contractor) : ''),
        ]),
        noun: ['permit', 'permits'],
      }),
    }),
    beat: 'development',
    sourceRecordIds: permits.map((p) => p.id),
  };
}

// --- Property sales --------------------------------------------------------------------------

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
export const useWords = (use: string | null): [string, string] =>
  USE_WORDS[(use ?? '').toUpperCase()] ?? [
    (use ? titleCase(use) : 'other property').toLowerCase(),
    `${(use ? titleCase(use) : 'other property').toLowerCase()} sales`,
  ];

export const medianOf = (values: number[]) => {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return 0;
  return v.length % 2 ? v[(v.length - 1) / 2]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2;
};

export function saleRows(sales: TemplateRecord[], timeZone: string) {
  return sales
    .map((s) => ({
      s,
      address: titleCase(labeled(s.text, /^address$/i) ?? s.title ?? ''),
      price: money(labeled(s.text, /^price$/i)),
      use: labeled(s.text, /^use$/i),
      day: saleDay(labeled(s.text, /^sale date$/i), timeZone),
      subdivision: labeled(s.text, /^subdivision$/i),
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
  const n = rows.length;
  const thin = n <= THIN_WEEK;
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
    headline: top
      ? `${top.address} sold for ${usd(top.price!)}, the highest of ${count(n, 'property sale', 'property sales')} in ${town.name}`
      : `Property sales in ${town.name}, ${range}`,
    dek: `${count(n, 'sale', 'sales')} recorded, ${range}.`,
    bodyMd: roundupBody({
      thin,
      lede: [
        trendSentence(n, past),
        n
          ? `The median price was ${usd(medianOf(rows.map((r) => r.price!)))}: ${list(mix)}.`
          : null,
      ],
      highlights: byPrice
        .slice(0, 5)
        .map(
          (r) =>
            `**${linked(md(r.address), r.s.url)}**: ${[usd(r.price!), useWords(r.use)[0], r.day].filter(Boolean).join(', ')}.`,
        ),
      dataTitle: `All ${count(n, 'sale', 'sales')}, highest first`,
      data: dataTable({
        head: ['Address', 'Price', 'Property', 'Sold'],
        rows: byPrice.map((r) => [
          linked(md(r.address), r.s.url),
          usd(r.price!),
          useWords(r.use)[0],
          r.day ?? '',
        ]),
        noun: ['sale', 'sales'],
      }),
    }),
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
  if (kind === 'nursing-homes') return nursingHomeCount(recs);
  return recs.length;
}

// --- Road work -------------------------------------------------------------------------------

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

/** "October 19, 2026" → a date. */
const roadDate = (value: string | undefined) => {
  const d = value ? new Date(`${value} 12:00 UTC`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/**
 * Road work and lane closures (owner, 2026-10-17: road closures are content people share), from
 * a county's weekly construction list: closures and detours lead, then every project in this
 * town. Built in code, Tier 1. Leads with this town's own closures and its busiest road.
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
  const from = roadDate(first.from);
  const to = roadDate(first.to);
  const range = from && to ? dayRange(from, to, town.timezone) : weekRange(town, weekStart);
  const n = rows.length;
  const thin = n <= THIN_WEEK;
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
  const line = (r: (typeof rows)[number]) =>
    `**${md(r.where)}**${r.work ? `: ${md(r.work)}.` : '.'}${r.restriction ? ` ${md(r.restriction)}` : ''}`;
  return {
    headline:
      closed.length === 1
        ? `${closed[0]!.where} closed or detoured; ${count(n, 'road project', 'road projects')} in ${town.name}, ${range}`
        : closed.length > 1
          ? `${cap(numWord(closed.length))} road closures or detours in ${town.name}, ${range}, including ${closed[0]!.where}`
          : busiest
            ? `${busiest[0]} has ${busiest[1]} of ${count(n, 'road project', 'road projects')} in ${town.name}, ${range}`
            : `${cap(count(n, 'road project', 'road projects'))} in ${town.name}, ${range}`,
    dek: `Road work and lane closures on the county's list for ${town.name}, ${range}.`,
    bodyMd: roundupBody({
      thin,
      lede: [
        closed.length
          ? `${list(closed.slice(0, 3).map((c) => md(c.where)))} ${closed.length === 1 ? 'has a road' : 'have roads'} closed or detoured.`
          : null,
        trendSentence(n, past),
        busiest ? `${md(busiest[0])} has the most projects, ${busiest[1]}.` : null,
      ],
      highlights: closed.slice(0, 4).map(line),
      dataTitle: `All ${count(n, 'project', 'projects')}, closures first`,
      data: dataTable({
        head: ['Location', 'Work', 'Restriction'],
        rows: rows.map((r) => [md(r.where), md(r.work), md(r.restriction)]),
        noun: ['project', 'projects'],
      }),
    }),
    beat: 'development',
    sourceRecordIds: items.map((i) => i.id),
  };
}

// --- Weather alerts --------------------------------------------------------------------------

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

// --- Federal awards --------------------------------------------------------------------------

/** Names that are clearly an organization; anything else may be a person and is never named. */
const ORGANIZATION =
  /\b(LLC|L\.L\.C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LP|LLP|LTD|PLLC|PA|PC|GROUP|HOLDINGS|ENTERPRISES|PARTNERS|UNIVERSITY|COLLEGE|SCHOOL|ACADEMY|CITY|COUNTY|TOWN|VILLAGE|STATE|DISTRICT|AUTHORITY|BOARD|DEPARTMENT|FOUNDATION|ASSOCIATION|SOCIETY|INSTITUTE|HOSPITAL|CENTER|CENTRE|CLINIC|CHURCH|TRUST|FUND|COUNCIL|COALITION|NETWORK|SYSTEMS|SERVICES|SOLUTIONS|TECHNOLOGIES|TECHNOLOGY|LABS?|LABORATORIES|PHARMACEUTICALS|INTERNATIONAL|INDUSTRIES|MATERIALS)\b/i;

const AWARD_KIND: Record<string, [string, string]> = {
  contract: ['contract', 'contracts'],
  grant: ['grant', 'grants'],
};

/** "DETENTION SERVICES IN …" → "Detention services in …", cut at a word near 90 characters. */
const sentence = (s: string, max = 90) => {
  const t = s.trim().toLowerCase();
  const cut = t.length <= max ? t : `${t.slice(0, max).replace(/\s+\S*$/, '')}…`;
  return cap(cut);
};

export function federalAwardRows(awards: TemplateRecord[]) {
  return awards
    .map((a) => ({
      a,
      recipient: labeled(a.text, /^recipient$/i) ?? a.title ?? '',
      kind: labeled(a.text, /^award type$/i) ?? 'contract',
      amount: Number(labeled(a.text, /^amount$/i) ?? NaN),
      agency: labeled(a.text, /^agency$/i),
      office: labeled(a.text, /^office$/i),
      what: labeled(a.text, /^description$/i),
      where: labeled(a.text, /^place of performance$/i),
    }))
    .filter((r) => Number.isFinite(r.amount) && r.amount > 0)
    .map((r) => ({ ...r, named: ORGANIZATION.test(r.recipient) }));
}

/**
 * New federal contracts and grants to recipients with a town address, last week (USASpending,
 * every town). Built in code, Tier 1: companies, universities and governments by name, the
 * agency and what the money is for. A recipient that may be a person is counted, never named.
 */
export function federalAwardsRoundup(
  town: TownInfo,
  weekStart: Date,
  awards: TemplateRecord[],
  past?: number[],
): TemplatedDraft {
  const range = weekRange(town, weekStart);
  const rows = federalAwardRows(awards).sort(
    (a, b) => b.amount - a.amount || a.recipient.localeCompare(b.recipient),
  );
  const named = rows.filter((r) => r.named);
  const n = rows.length;
  const thin = n <= THIN_WEEK;
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const top = named[0];
  const byAgency = ranked(tally(rows, (r) => r.agency));
  const kinds = ranked(tally(rows, (r) => r.kind)).map(([k, c]) =>
    count(c, ...(AWARD_KIND[k] ?? [k, `${k}s`])),
  );
  const recipients = ranked(tally(named, (r) => titleCase(r.recipient)));
  const repeat = recipients[0] && recipients[0][1] > 1 ? recipients[0] : null;
  const elsewhere = named.filter((r) => r.where && r.where !== 'FL');
  const describe = (r: (typeof rows)[number]) =>
    [
      usd(r.amount),
      r.office && r.office !== r.agency
        ? `from ${md(r.office)}`
        : r.agency
          ? `from the ${md(r.agency)}`
          : null,
      r.what ? `for ${md(sentence(r.what).replace(/^./, (c) => c.toLowerCase()))}` : null,
      r.where && r.where !== 'FL' ? `(work in ${r.where})` : null,
    ]
      .filter(Boolean)
      .join(' ');
  const where = `with a ${town.name} address`;
  return {
    headline: top
      ? `${titleCase(top.recipient)} gets ${usd(top.amount)} federal ${AWARD_KIND[top.kind]?.[0] ?? 'award'}, the largest of ${count(n, 'award', 'awards')} to recipients ${where}`
      : `${count(n, 'federal award', 'federal awards')} to recipients ${where}, ${range}`,
    dek: `${count(n, 'new federal award', 'new federal awards')} worth ${usd(total)}, ${range}.`,
    bodyMd: roundupBody({
      thin,
      lede: [
        `Federal agencies made ${list(kinds)} worth ${usd(total)} in all to recipients ${where}.`,
        trendSentence(n, past),
        byAgency.length > 1
          ? `The ${md(byAgency[0]![0])} made the most, ${byAgency[0]![1]}.`
          : null,
        repeat ? `${md(repeat[0])} received ${numWord(repeat[1])} of them.` : null,
      ],
      highlights: [
        ...named
          .slice(0, 4)
          .map((r) => `**${linked(md(titleCase(r.recipient)), r.a.url)}**: ${describe(r)}.`),
        elsewhere.length
          ? `${cap(count(elsewhere.length, 'award is', 'awards are'))} for work outside Florida.`
          : null,
      ].filter((h): h is string => h !== null),
      dataTitle: `All ${count(n, 'award', 'awards')}, largest first`,
      data: dataTable({
        head: ['Recipient', 'Agency', 'Amount', 'Type', 'For'],
        rows: rows.map((r) => [
          r.named ? linked(md(titleCase(r.recipient)), r.a.url) : 'Not named (may be a person)',
          md(r.office ?? r.agency ?? ''),
          usd(r.amount),
          r.kind,
          r.what ? md(sentence(r.what, 70)) : '',
        ]),
        noun: ['award', 'awards'],
      }),
    }),
    beat: 'business',
    sourceRecordIds: rows.map((r) => r.a.id),
  };
}

// --- Nursing homes ---------------------------------------------------------------------------

/** The four rows of CMS's scope and severity grid, in a few words for tables. */
const HARM_SHORT = ['', 'minimal harm', 'no actual harm', 'actual harm', 'immediate jeopardy'];

export const CARE_COMPARE_HOMES = 'https://www.medicare.gov/care-compare/?providerType=NursingHome';

/** "Quality of Life and Care Deficiencies" → "quality of life and care". */
export const citationArea = (category: string) =>
  category
    .replace(/\s+deficiencies$/i, '')
    .trim()
    .toLowerCase();

/** "July 10", or "Dec. 3, 2025" outside the year of `ref`. */
export const isoDay = (iso: string, ref: Date) => {
  const year = iso.slice(0, 4);
  const d = apDate(new Date(`${iso}T12:00:00Z`), 'UTC');
  return year === String(ref.getUTCFullYear()) ? d : `${d}, ${year}`;
};

export type NursingHomeVisit = {
  r: TemplateRecord;
  v: NursingHomeInspection;
  name: string;
  /** 1 (minimal harm) to 4 (immediate jeopardy), from the most serious citation. */
  level: number;
};

/** Inspections, most serious first, and penalties, largest first, from the CMS records. */
export function nursingHomeRows(recs: TemplateRecord[]) {
  const visits: NursingHomeVisit[] = recs
    .filter((r) => r.type === 'nursing-home-inspection')
    .map((r) => {
      const v = (r.raw ?? {}) as NursingHomeInspection;
      return { r, v, name: titleCase(v.name ?? r.title ?? ''), level: severityLevel(v.worst) };
    })
    .filter((x) => x.v.ccn && x.v.date && Array.isArray(x.v.citations))
    .sort(
      (a, b) =>
        (b.v.worst ?? '').localeCompare(a.v.worst ?? '') ||
        b.v.citations.length - a.v.citations.length ||
        a.name.localeCompare(b.name),
    );
  const penalties = recs
    .filter((r) => r.type === 'nursing-home-penalty')
    .map((r) => {
      const p = (r.raw ?? {}) as NursingHomePenalty;
      return { r, p, name: titleCase(p.name ?? r.title ?? '') };
    })
    .filter((x) => x.p.ccn && x.p.date)
    .sort((a, b) => (b.p.amount ?? 0) - (a.p.amount ?? 0) || a.name.localeCompare(b.name));
  return { visits, penalties };
}

/** Distinct homes in the records (the roundup's unit). */
export const nursingHomeCount = (recs: TemplateRecord[]) => {
  const { visits, penalties } = nursingHomeRows(recs);
  return new Set([...visits.map((x) => x.v.ccn), ...penalties.map((x) => x.p.ccn)]).size;
};

/** "a $13,065 fine", "a 30-day payment denial". */
export const penaltyWords = (p: NursingHomePenalty) =>
  p.type === 'fine'
    ? p.amount
      ? `a ${usd(p.amount)} fine`
      : 'a fine'
    : p.denialDays
      ? `a ${p.denialDays}-day payment denial`
      : 'a payment denial';

/** "Federal regulators imposed a $13,065 fine on X on March 13." */
export const penaltyLine = (name: string, p: NursingHomePenalty, day: (iso: string) => string) =>
  `Federal regulators imposed ${penaltyWords(p)} on ${md(name)} on ${day(p.date)}.`;

/** The visit's most serious citation. */
export const worstCitation = (v: NursingHomeInspection) =>
  v.citations.find((c) => c.severity === v.worst) ?? v.citations[0];

/** "rated actual harm (G) on CMS's scale". */
export const ratedWords = (code: string) => {
  const level = severityLevel(code);
  return level ? `rated ${HARM_SHORT[level]} (${code}) on the federal scale` : `rated ${code}`;
};

/**
 * Federal health inspections and penalties of nursing homes with a town address, as CMS
 * publishes them (Care Compare, every town). Records arrive with CMS's monthly release, two to
 * six months after the visit, so this rounds up what was first read last week, by when each
 * record was stored, not the inspection date. Always Tier 3 (§7: health findings at a named
 * facility). Leads with the most serious finding: immediate jeopardy, then actual harm, then the
 * largest penalty, then the most citations. Only facilities are named; a citation quotes the
 * federal requirement, never a resident, worker or inspector.
 */
export function nursingHomesRoundup(
  town: TownInfo,
  weekStart: Date,
  recs: TemplateRecord[],
): TemplatedDraft {
  const { visits, penalties } = nursingHomeRows(recs);
  const n = nursingHomeCount(recs);
  const inspected = new Set(visits.map((x) => x.v.ccn)).size;
  const where = `with a ${town.name} address`;
  const day = (iso: string) => isoDay(iso, weekStart);
  const cited = visits.reduce((sum, x) => sum + x.v.citations.length, 0);
  const serious = visits.reduce(
    (sum, x) => sum + x.v.citations.filter((c) => severityLevel(c.severity) >= 3).length,
    0,
  );
  const fined = penalties.reduce((sum, x) => sum + (x.p.amount ?? 0), 0);
  const top = visits[0];
  const topPenalty = penalties[0];
  const thin = n <= 2 && !serious && !penalties.length;
  const areas = ranked(
    tally(
      visits.flatMap((x) => x.v.citations),
      (c) => (c.category ? citationArea(c.category) : null),
    ),
  );
  const listed = Math.max(
    0,
    ...visits.map((x) => x.v.homesInTown ?? 0),
    ...penalties.map((x) => x.p.homesInTown ?? 0),
  );
  const dates = visits.map((x) => x.v.date).sort();
  const span = !dates.length
    ? null
    : dates[0] === dates.at(-1)
      ? `on ${day(dates[0]!)}`
      : `between ${day(dates[0]!)} and ${day(dates.at(-1)!)}`;
  const among = n > 1 ? `, one of ${n} nursing homes ${where} in the latest federal data` : '';

  const headline =
    top && top.level >= 3
      ? `Federal inspectors cite ${top.level === 4 ? 'immediate jeopardy' : 'actual harm'} at ${top.name}${among || `, a nursing home ${where}`}`
      : topPenalty
        ? `Federal regulators give ${topPenalty.name} ${penaltyWords(topPenalty.p)}${among || `, a nursing home ${where}`}`
        : top
          ? `${top.name} gets ${count(top.v.citations.length, 'citation', 'citations')} in a federal inspection${among || `, a nursing home ${where}`}`
          : `${count(n, 'nursing home', 'nursing homes')} ${where} in the latest federal data`;

  const leadVisit = (x: NursingHomeVisit) => {
    const c = worstCitation(x.v);
    const addr = x.v.address ? titleCase(x.v.address) : null;
    return [
      `Federal health inspectors who visited ${md(x.name)}${addr ? `, at ${md(addr)},` : ''} on ${day(x.v.date)} issued ${count(x.v.citations.length, 'citation', 'citations')}.`,
      c
        ? `The most serious, ${ratedWords(c.severity)}, was under ${md(citationArea(c.category))}: "${md(c.description)}"`
        : null,
      x.v.previous
        ? `At its previous inspection with citations, on ${day(x.v.previous.date)}, it received ${numWord(x.v.previous.citations)}.`
        : null,
    ];
  };
  const penaltySentence = (x: (typeof penalties)[number]) => penaltyLine(x.name, x.p, day);
  const visitLine = (x: NursingHomeVisit) => {
    const c = worstCitation(x.v);
    return [
      `**${linked(md(x.name), x.r.url)}**: inspected ${day(x.v.date)}${x.v.kinds?.length ? ` (${x.v.kinds.join(', ')})` : ''}`,
      count(x.v.citations.length, 'citation', 'citations'),
      c ? `most serious ${c.severity}, ${md(citationArea(c.category))}` : null,
      x.v.previous ? `${x.v.previous.citations} at its previous inspection` : null,
    ]
      .filter(Boolean)
      .join('; ');
  };

  return {
    headline,
    dek: [
      visits.length
        ? `${cap(count(cited, 'citation', 'citations'))} from federal health inspections of ${count(inspected, 'nursing home', 'nursing homes')} ${where}${span ? `, ${span}` : ''}`
        : `Medicare penalties for ${count(n, 'nursing home', 'nursing homes')} ${where}`,
      fined ? `${usd(fined)} in fines` : null,
    ]
      .filter(Boolean)
      .join('; ')
      .concat('.'),
    bodyMd: roundupBody({
      thin,
      lede: [
        ...(top ? leadVisit(top) : penalties.slice(0, 2).map(penaltySentence)),
        inspected > 1
          ? `Inspectors issued the ${numWord(inspected)} homes ${count(cited, 'citation', 'citations')} in all${serious ? `; ${numWord(serious)} ${serious === 1 ? 'was' : 'were'} rated actual harm or immediate jeopardy` : ', none rated as actual harm to a resident'}.`
          : null,
        areas.length > 1 && areas[0]![1] > 1
          ? `The areas cited most were ${list(areas.slice(0, 3).map(([a, k]) => `${md(a)} (${k})`))}.`
          : null,
        top && penalties.length ? penalties.slice(0, 2).map(penaltySentence).join(' ') : null,
        listed > n ? `CMS lists ${listed} nursing homes ${where}.` : null,
      ],
      highlights: [
        ...visits.slice(0, 4).map(visitLine),
        ...penalties
          .slice(0, 2)
          .map(
            (x) =>
              `**${linked(md(x.name), x.r.url)}**: ${penaltyWords(x.p)}, imposed ${day(x.p.date)}`,
          ),
      ],
      dataTitle: `All ${count(visits.length, 'inspection', 'inspections')}, most serious first`,
      data: visits.length
        ? dataTable({
            head: ['Nursing home', 'Inspected', 'Type', 'Citations', 'Most serious'],
            rows: visits.map((x) => [
              linked(md(x.name), x.r.url),
              day(x.v.date),
              (x.v.kinds ?? []).join(', '),
              String(x.v.citations.length),
              x.v.worst ? `${x.v.worst} (${HARM_SHORT[x.level] || 'not rated'})` : '',
            ]),
            noun: ['inspection', 'inspections'],
          })
        : undefined,
      readers: `Each home's ratings and inspection reports are on [Medicare's Care Compare](${CARE_COMPARE_HOMES}).`,
    }),
    beat: 'business',
    sourceRecordIds: recs.map((r) => r.id),
  };
}
