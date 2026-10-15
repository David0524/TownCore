import type { RawRecord, SourceAdapter, SourceConfig } from '../types';

// Florida Division of Corporations daily filings ("Sunbiz"), state level: every Florida town
// reuses it. Each work day's file lists the corporations, LLCs and partnerships filed that day.
// Files: https://sftp.floridados.gov/Public/doc/cor/YYYYMMDDc.txt (documented-API exception).
// Source config: { city: "BOCA RATON" } — filings whose principal address is in that city.

const FILES = 'https://sftp.floridados.gov/Public/doc/cor/';

// The state publishes this login for the public download server (not a secret):
// https://dos.fl.gov/sunbiz/other-services/data-downloads/daily-data/
const PUBLIC_LOGIN = 'Public:PubAccess1845!';

/** How far back to look when a source has never run, and the most days fetched per run. */
const FIRST_RUN_DAYS = 7;
const MAX_DAYS_PER_RUN = 14;

// Fixed-width layout (1-based start, length) from the state's corporate file definitions,
// https://dos.sunbiz.org/data-definitions/cor.html (read 2026-10-15; that host isn't fetched).
const FIELDS = {
  number: [1, 12],
  name: [13, 192],
  status: [205, 1],
  filingType: [206, 15],
  address1: [221, 42],
  address2: [263, 42],
  city: [305, 28],
  state: [333, 2],
  zip: [335, 10],
  fileDate: [473, 8],
  agentName: [545, 42],
  agentType: [587, 1],
} as const satisfies Record<string, readonly [number, number]>;

// Officers repeat from position 669 in 128-character blocks (6 in the daily file).
const OFFICER_START = 669;
const OFFICER_SIZE = 128;
const OFFICERS = 6;

export const filingTypes: Record<string, string> = {
  DOMP: 'Florida profit corporation',
  DOMNP: 'Florida nonprofit corporation',
  FORP: 'Foreign profit corporation',
  FORNP: 'Foreign nonprofit corporation',
  DOMLP: 'Florida limited partnership',
  FORLP: 'Foreign limited partnership',
  FLAL: 'Florida limited liability company',
  FORL: 'Foreign limited liability company',
  NPREG: 'Nonprofit registration',
  TRUST: 'Declaration of trust',
  AGENT: 'Designation of registered agent',
};

type Filing = Record<keyof typeof FIELDS, string> & {
  officers: Array<{ title: string; type: string; name: string; city: string; state: string }>;
};

const slice = (line: string, start: number, length: number) =>
  line.slice(start - 1, start - 1 + length).trim();

export function parseFiling(line: string): Filing | null {
  if (line.length < 500 || !/^[A-Z0-9]/.test(line)) return null;
  const filing = Object.fromEntries(
    Object.entries(FIELDS).map(([key, [start, length]]) => [key, slice(line, start, length)]),
  ) as unknown as Filing;
  filing.officers = [];
  for (let i = 0; i < OFFICERS; i++) {
    const at = OFFICER_START + i * OFFICER_SIZE;
    const name = slice(line, at + 5, 42);
    if (!name) continue;
    filing.officers.push({
      title: slice(line, at, 4),
      type: slice(line, at + 4, 1),
      name,
      city: slice(line, at + 89, 28),
      state: slice(line, at + 117, 2),
    });
  }
  return filing.number ? filing : null;
}

/** MMDDYYYY → Date (UTC midnight). */
function parseDate(value: string): Date | null {
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec(value);
  return m ? new Date(Date.UTC(+m[3]!, +m[1]! - 1, +m[2]!)) : null;
}

export function filingRecord(filing: Filing, fileUrl: string): RawRecord {
  const kind = filingTypes[filing.filingType] ?? filing.filingType;
  const street = [filing.address1, filing.address2].filter(Boolean).join(', ');
  // Officer names stay in `raw` only; the text describes the entity, not private people.
  return {
    externalId: `filing:${filing.number}`,
    type: 'new-filing',
    title: filing.name,
    text: [
      `${kind}, document number ${filing.number}, filed ${filing.fileDate.replace(/^(\d{2})(\d{2})(\d{4})$/, '$1/$2/$3')}.`,
      `Principal address: ${[street, filing.city, [filing.state, filing.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')}.`,
      filing.status === 'A'
        ? 'Status: active.'
        : filing.status === 'I'
          ? 'Status: inactive.'
          : null,
    ]
      .filter(Boolean)
      .join(' '),
    url: fileUrl,
    occurredAt: parseDate(filing.fileDate),
    raw: filing,
  };
}

function cityOf(source: SourceConfig): string {
  const city = (source.config as { city?: unknown }).city;
  if (typeof city !== 'string' || !city.trim())
    throw new Error(`fl-sunbiz source ${source.id} needs config.city`);
  return city.trim().toUpperCase();
}

/** File names for each day after `since` (or the last week), oldest first, capped. */
export function dailyFileNames(since: Date | null, now: Date): string[] {
  const start = since ?? new Date(now.getTime() - FIRST_RUN_DAYS * 86_400_000);
  const names: string[] = [];
  const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  while (day <= now) {
    names.push(`${day.toISOString().slice(0, 10).replace(/-/g, '')}c.txt`);
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return names.slice(-MAX_DAYS_PER_RUN);
}

const auth = { authorization: `Basic ${Buffer.from(PUBLIC_LOGIN).toString('base64')}` };

export const flSunbizAdapter: SourceAdapter = {
  platform: 'fl-sunbiz',
  kinds: ['business_filings'],

  async detect(url) {
    return /(^|\.)(floridados\.gov|sunbiz\.org)$/i.test(new URL(url).hostname) ? 1 : 0;
  },

  async fetch(source, since, { fetcher, now }) {
    const city = cityOf(source);
    const records: RawRecord[] = [];
    for (const name of dailyFileNames(since, now)) {
      const url = `${FILES}${name}`;
      const response = await fetcher.get(url, auth);
      // No file on weekends, holidays or before today's file is published.
      if (response.status === 404) continue;
      if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`);
      // Positions are bytes in a single-byte encoding; latin1 keeps one byte per character.
      const text = new TextDecoder('latin1').decode(await response.arrayBuffer());
      for (const line of text.split(/\r?\n/)) {
        const filing = parseFiling(line);
        if (filing && filing.city.toUpperCase() === city) records.push(filingRecord(filing, url));
      }
    }
    return records;
  },

  async healthCheck(_source, { fetcher }) {
    const response = await fetcher.get(`${FILES}README.TXT`, auth);
    return response.ok ? { ok: true } : { ok: false, detail: `HTTP ${response.status}` };
  },
};
