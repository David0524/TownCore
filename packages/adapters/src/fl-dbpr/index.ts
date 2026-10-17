import { createHash } from 'node:crypto';
import { NotModified } from '../http/fetcher';
import { parseCsvLine, streamLines } from '../lib/csv';
import type { RawRecord, SourceAdapter, SourceConfig } from '../types';
import { dbprOccupations, dbprPrimaryStatus, dbprSecondaryStatus } from './codes';
import {
  FOOD_FILE,
  foodRecord,
  NEW_FOOD_FILE,
  newFoodRecord,
  parseFoodRow,
  parseNewFoodRow,
} from './food';
import { INSPECTION_FILE, inspectionRecord, parseInspectionRow } from './inspections';
import { isNewLiquorLicense, LIQUOR_FILE, liquorRecord, parseLiquorRow } from './liquor';

// Florida Department of Business and Professional Regulation licensee files (CLAUDE.md §9:
// state-level adapter, written once, reused by every Florida town). Free public records under
// Chapter 119, F.S., refreshed weekly: https://www2.myfloridalicense.com/public-records-read-medisclaimer/
// Each file is statewide; rows are filtered to the town's city. Conditional GET skips unchanged
// files. Source config: { city: "BOCA RATON", files?: string[] }. Food service files
// (hrfood1–7.csv, and newfood.csv for new establishments) use the Hotels and Restaurants
// layout in ./food.ts; food service inspections (1fdinspi–7fdinspi.csv) are in ./inspections.ts;
// the alcoholic beverage daily activity file (daily.csv, new licenses only) is in ./liquor.ts.

const EXTRACTS = 'https://www2.myfloridalicense.com/sto/file_download/extracts/';

/**
 * Default files: construction and electrical contractors, which use the standard layout below.
 * Some files (e.g. RealEstateCorpLicense.csv) use a different layout; they need their own parser
 * before being added (planned with the directory, M6).
 */
export const DEFAULT_FILES = ['CONSTRUCTIONLICENSE_1.csv', 'lic08el.csv'];

// Standard DBPR licensee file layout (no header row), as published on each board's page.
const COLUMNS = [
  'board',
  'occupationCode',
  'licenseeName',
  'dbaName',
  'classCode',
  'address1',
  'address2',
  'address3',
  'city',
  'state',
  'zip',
  'countyCode',
  'licenseNumber',
  'primaryStatus',
  'secondaryStatus',
  'originalLicensureDate',
  'effectiveDate',
  'expirationDate',
  'blank',
  'renewalPeriod',
  'alternateLicenseNumber',
  'ceExemption',
] as const;
export type DbprRow = Record<(typeof COLUMNS)[number], string>;

export function parseDbprRow(line: string): DbprRow | null {
  const fields = parseCsvLine(line);
  // Standard-layout rows start with a two-digit board number; anything else isn't this layout.
  if (fields.length < 21 || !/^\d{2}$/.test(fields[0] ?? '')) return null;
  return Object.fromEntries(COLUMNS.map((c, i) => [c, (fields[i] ?? '').trim()])) as DbprRow;
}

/** MM/DD/YYYY → Date (UTC midnight), or null. */
function parseDate(value: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  return m ? new Date(Date.UTC(+m[3]!, +m[1]! - 1, +m[2]!)) : null;
}

export function dbprRecord(row: DbprRow, fileUrl: string): RawRecord {
  const occupation = dbprOccupations[`${row.board}:${row.occupationCode}`] ?? row.occupationCode;
  const license = row.alternateLicenseNumber || `${row.occupationCode}${row.licenseNumber}`;
  const status = [dbprPrimaryStatus[row.primaryStatus], dbprSecondaryStatus[row.secondaryStatus]]
    .filter(Boolean)
    .join(', ');
  const street = [row.address1, row.address2, row.address3].filter(Boolean).join(', ');
  const business = row.dbaName || row.licenseeName;
  // One license can have several rows (e.g. the qualifier and the financially responsible
  // officer), so the ID covers the license, the occupation and the person.
  const person = createHash('sha256')
    .update(`${row.licenseeName}|${row.dbaName}`.toUpperCase())
    .digest('hex')
    .slice(0, 12);
  return {
    externalId: `license:${license}:${row.occupationCode}:${person}`,
    type: 'license',
    title: business,
    text: [
      `${occupation}, license ${license}${status ? ` (${status})` : ''}.`,
      `Licensee: ${row.licenseeName}${row.dbaName ? `, doing business as ${row.dbaName}` : ''}.`,
      `Address: ${street}, ${row.city}, ${row.state} ${row.zip}.`,
      row.originalLicensureDate ? `First licensed ${row.originalLicensureDate}.` : null,
      row.expirationDate ? `Expires ${row.expirationDate}.` : null,
    ]
      .filter(Boolean)
      .join(' '),
    url: fileUrl,
    occurredAt: parseDate(row.originalLicensureDate) ?? parseDate(row.effectiveDate),
    raw: { ...row, occupation },
  };
}

function options(source: SourceConfig): { city: string; files: string[] } {
  const { city, files } = source.config as { city?: unknown; files?: unknown };
  if (typeof city !== 'string' || !city.trim()) {
    throw new Error(`fl-dbpr source ${source.id} needs config.city, e.g. "BOCA RATON"`);
  }
  const list = Array.isArray(files) ? files.map(String) : DEFAULT_FILES;
  for (const file of list) {
    if (!/^[\w-]+\.csv$/.test(file)) throw new Error(`fl-dbpr: invalid file name ${file}`);
  }
  return { city: city.trim().toUpperCase(), files: list };
}

export const flDbprAdapter: SourceAdapter = {
  platform: 'fl-dbpr',
  kinds: ['business_filings', 'inspections'],

  async detect(url) {
    return /(^|\.)myfloridalicense\.com$/i.test(new URL(url).hostname) ? 1 : 0;
  },

  async fetch(source, since, { fetcher }) {
    const { city, files } = options(source);
    const records: RawRecord[] = [];
    let unchanged = 0;
    for (const file of files) {
      const url = `${EXTRACTS}${file}`;
      const response = await fetcher.get(
        url,
        since ? { 'if-modified-since': since.toUTCString() } : {},
      );
      if (response.status === 304) {
        unchanged++;
        continue;
      }
      if (!response.ok || !response.body)
        throw new Error(`GET ${url} failed: HTTP ${response.status}`);
      const food = FOOD_FILE.test(file);
      const newFood = NEW_FOOD_FILE.test(file);
      const inspections = INSPECTION_FILE.test(file);
      const liquor = LIQUOR_FILE.test(file);
      for await (const line of streamLines(response.body)) {
        if (liquor) {
          const row = parseLiquorRow(line);
          if (row && row.city.toUpperCase() === city && isNewLiquorLicense(row)) {
            const record = liquorRecord(row, url);
            if (record) records.push(record);
          }
          continue;
        }
        if (inspections) {
          const row = parseInspectionRow(line);
          if (row && row.city.toUpperCase() === city) records.push(inspectionRecord(row, url));
          continue;
        }
        if (newFood) {
          const row = parseNewFoodRow(line);
          if (row && row.city.toUpperCase() === city) records.push(newFoodRecord(row, url));
          continue;
        }
        if (food) {
          const row = parseFoodRow(line);
          if (row && row.city.toUpperCase() === city) records.push(foodRecord(row, url));
          continue;
        }
        const row = parseDbprRow(line);
        if (row && row.city.toUpperCase() === city) records.push(dbprRecord(row, url));
      }
    }
    // Every file unchanged since the last run: nothing new, and not a health problem.
    if (unchanged === files.length)
      throw new NotModified('All DBPR files unchanged since the last run');
    return records;
  },

  async healthCheck(source, { fetcher }) {
    try {
      const { files } = options(source);
      const response = await fetcher.get(`${EXTRACTS}${files[0]}`, { range: 'bytes=0-1023' });
      return response.ok ? { ok: true } : { ok: false, detail: `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  },
};
