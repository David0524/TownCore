import { titleCase } from '@towncore/config';
import { apDate } from './time';

// Items built in code from structured records (CLAUDE.md §6 step 2: "templated jobs, not
// candidates"). No model writes them, so every fact is copied straight from a record; the
// tier router and publish rules still apply. Roundups link out to the official pages.

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

type TownInfo = { name: string; timezone: string; agency: string };

const byTime = (a: TemplateRecord, b: TemplateRecord) =>
  (a.occurredAt?.getTime() ?? 0) - (b.occurredAt?.getTime() ?? 0);

// Markdown-escape text that came from a record (names can contain * _ [ ]).
const md = (s: string) => s.replace(/([\\*_[\]`<>])/g, '\\$1');

/** "Meetings this week" (D-M3-6): each public meeting on the city calendar for the week. */
export function meetingsRoundup(
  town: TownInfo,
  weekStart: Date,
  meetings: TemplateRecord[],
): TemplatedDraft {
  const weekEnd = new Date(weekStart.getTime() + 6 * 86_400_000);
  const range = `${apDate(weekStart, town.timezone)}–${apDate(weekEnd, town.timezone)}`;
  const items = [...meetings].sort(byTime).map((m) => {
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
  return {
    headline: `Public meetings in ${town.name}, ${range}`,
    dek: `${meetings.length} ${meetings.length === 1 ? 'meeting is' : 'meetings are'} on the ${town.agency} calendar this week.`,
    bodyMd: [
      `These public meetings are on the ${town.agency} calendar for the week of ${range}. Agendas are posted by the city; times can change, so check the meeting page before you go.`,
      items.join('\n'),
    ].join('\n\n'),
    beat: 'government',
    sourceRecordIds: meetings.map((m) => m.id),
  };
}

// State records give a mailing city, not a municipality: a "Boca Raton" address can be outside
// city limits (e.g. West Boca). Roundups say so rather than claim the business is in the city.
// Exact city limits need parcel lookups (planned with the directory, M6).
const MAILING_CITY_NOTE = (name: string) =>
  `A ${name} mailing address can be outside the city limits.`;

type Filing = { name?: string; number?: string; fileDate?: string; zip?: string };

/** "New businesses registered" from Florida Division of Corporations daily filings. */
export function newBusinessesRoundup(
  town: TownInfo,
  weekStart: Date,
  filings: TemplateRecord[],
): TemplatedDraft {
  const weekEnd = new Date(weekStart.getTime() + 6 * 86_400_000);
  const range = `${apDate(weekStart, town.timezone)}–${apDate(weekEnd, town.timezone)}`;
  const rows = filings
    .map((f) => {
      const raw = (f.raw ?? {}) as Filing;
      // The record text starts "<kind>, document number <n>, filed <MM/DD/YYYY>."
      const kind = f.text?.match(/^(.*?), document number/)?.[1] ?? 'Filing';
      const filed = f.text?.match(/, filed (\d{2}\/\d{2}\/\d{4})\./)?.[1];
      // Principal addresses are often homes: list the ZIP code only.
      const zip = raw.zip?.slice(0, 5);
      return {
        name: f.title ?? raw.name ?? '',
        line: [kind, filed ? `filed ${filed}` : null, zip ? `ZIP ${zip}` : null]
          .filter(Boolean)
          .join(', '),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    headline: `New businesses registered with a ${town.name} address, ${range}`,
    dek: `${filings.length} new ${filings.length === 1 ? 'filing lists' : 'filings list'} a ${town.name} mailing address, according to the Florida Division of Corporations.`,
    bodyMd: [
      `The Florida Division of Corporations recorded ${filings.length} new business ${filings.length === 1 ? 'filing' : 'filings'} with a ${town.name} mailing address from ${range}. A filing registers a company with the state; it doesn't mean the business has opened. ${MAILING_CITY_NOTE(town.name)}`,
      rows.map((r) => `- **${md(r.name)}**: ${md(r.line)}`).join('\n'),
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
): TemplatedDraft {
  const weekEnd = new Date(weekStart.getTime() + 6 * 86_400_000);
  const range = `${apDate(weekStart, town.timezone)}–${apDate(weekEnd, town.timezone)}`;
  const rows = licenses
    .map((l) => {
      const raw = (l.raw ?? {}) as License;
      const license =
        raw.alternateLicenseNumber || `${raw.occupationCode ?? ''}${raw.licenseNumber ?? ''}`;
      return {
        name: raw.dbaName || raw.licenseeName || l.title || '',
        line: [raw.occupation, license ? `license ${license}` : null].filter(Boolean).join(', '),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    headline: `New contractor licenses with a ${town.name} address, ${range}`,
    dek: `The Florida Department of Business and Professional Regulation issued ${licenses.length} new ${licenses.length === 1 ? 'license' : 'licenses'} to contractors with a ${town.name} mailing address.`,
    bodyMd: [
      `These contractors with a ${town.name} mailing address were first licensed by the Florida Department of Business and Professional Regulation from ${range}. You can check any contractor's license status on the state's licensing site before hiring. ${MAILING_CITY_NOTE(town.name)}`,
      rows.map((r) => `- **${md(r.name)}**: ${md(r.line)}`).join('\n'),
    ].join('\n\n'),
    beat: 'business',
    sourceRecordIds: licenses.map((l) => l.id),
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
): TemplatedDraft {
  const weekEnd = new Date(weekStart.getTime() + 6 * 86_400_000);
  const range = `${apDate(weekStart, town.timezone)}–${apDate(weekEnd, town.timezone)}`;
  // Each establishment once: its visits in date order, judged by the most serious one.
  const groups = new Map<string, Inspection[]>();
  for (const r of inspections) {
    const raw = (r.raw ?? {}) as Inspection;
    const key = raw.licenseNumber || raw.business || r.id;
    groups.set(key, [...(groups.get(key) ?? []), raw]);
  }
  const places = [...groups.values()].map((visits) => {
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
  const section = (title: string, list: typeof places, note: string) =>
    list.length ? [`## ${title}`, note, list.map(line).join('\n')].join('\n\n') : null;
  const counts = [
    closures.length ? `${closures.length} ordered closed` : null,
    complaints.length ? `${complaints.length} with an administrative complaint recommended` : null,
  ].filter(Boolean);
  const n = places.length;
  const establishments = (k: number) => (k === 1 ? 'establishment' : 'establishments');
  return {
    headline: `Restaurant inspections with a ${town.name} address, ${range}`,
    dek: `State inspectors visited ${n} food service ${establishments(n)}${counts.length ? `; ${counts.join(' and ')}` : ''}.`,
    bodyMd: [
      `The Florida Division of Hotels and Restaurants inspected ${n} food service ${establishments(n)} with a ${town.name} address from ${range}, according to the state's weekly inspection file. An inspection is a snapshot of conditions on the day of the visit; the state says it may not reflect an establishment's usual conditions. ${MAILING_CITY_NOTE(town.name)}`,
      section(
        'Ordered closed',
        closures,
        'Inspectors recommended an emergency order, which closes an establishment until a follow-up visit finds the problems fixed.',
      ),
      section(
        'Administrative complaint recommended',
        complaints,
        'An administrative complaint can lead to a fine. The establishment stays open.',
      ),
      section(
        'Warnings and follow-ups',
        warnings,
        'Inspectors issued a warning or gave more time to fix violations before a call-back visit.',
      ),
      passed.length
        ? [
            '## Met inspection standards',
            `${passed.length} ${establishments(passed.length)} needed no further action: ${passed.map((p) => md(p.name)).join(', ')}.`,
          ].join('\n\n')
        : null,
      `Inspection results come from the [Florida Department of Business and Professional Regulation](${INSPECTIONS_PAGE}), where you can also look up an establishment's full inspection history.`,
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
): TemplatedDraft {
  const weekEnd = new Date(weekStart.getTime() + 6 * 86_400_000);
  const range = `${apDate(weekStart, town.timezone)}–${apDate(weekEnd, town.timezone)}`;
  const rows = permits.map((p) => ({
    p,
    title: titleCase(p.title ?? 'Permit'),
    type: labeled(p.text, /^(type|permit type|application type)$/i),
    cost: money(labeled(p.text, /cost|valuation|value/i)),
    contractor: labeled(p.text, /^contractor/i),
  }));
  const ranked = [...rows].sort(
    (a, b) => (b.cost ?? 0) - (a.cost ?? 0) || a.title.localeCompare(b.title),
  );
  const listed = ranked.slice(0, PERMITS_LISTED);
  const total = rows.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  const byType = new Map<string, number>();
  for (const r of rows) {
    const t = r.type ? titleCase(r.type) : 'Other';
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  const n = permits.length;
  return {
    headline: `Building permits in ${town.name}, ${range}`,
    dek: `${n} ${n === 1 ? 'permit' : 'permits'}${total > 0 ? ` with a combined estimated cost of ${usd(total)}` : ''}, according to the official permit records.`,
    bodyMd: [
      `These are the permits in ${town.name}'s official permit records from ${range}. Estimated costs are the applicant's figures.`,
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
      byType.size > 1
        ? [
            '## By type',
            [...byType.entries()]
              .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
              .map(([t, k]) => `- ${md(t)}: ${k}`)
              .join('\n'),
          ].join('\n\n')
        : null,
    ]
      .filter(Boolean)
      .join('\n\n'),
    beat: 'development',
    sourceRecordIds: permits.map((p) => p.id),
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
