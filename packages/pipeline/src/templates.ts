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
    headline: `New businesses registered in ${town.name}, ${range}`,
    dek: `${filings.length} new ${filings.length === 1 ? 'filing lists' : 'filings list'} a principal address in ${town.name}, according to the Florida Division of Corporations.`,
    bodyMd: [
      `The Florida Division of Corporations recorded ${filings.length} new business ${filings.length === 1 ? 'filing' : 'filings'} with a principal address in ${town.name} from ${range}. A filing registers a company with the state; it doesn't mean the business has opened.`,
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
    headline: `New contractor licenses in ${town.name}, ${range}`,
    dek: `The Florida Department of Business and Professional Regulation issued ${licenses.length} new ${licenses.length === 1 ? 'license' : 'licenses'} to contractors with a ${town.name} address.`,
    bodyMd: [
      `These contractors with a ${town.name} address were first licensed by the Florida Department of Business and Professional Regulation from ${range}. You can check any contractor's license status on the state's licensing site before hiring.`,
      rows.map((r) => `- **${md(r.name)}**: ${md(r.line)}`).join('\n'),
    ].join('\n\n'),
    beat: 'business',
    sourceRecordIds: licenses.map((l) => l.id),
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
