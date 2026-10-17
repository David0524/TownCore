import { parseCsvLine } from '../lib/csv';
import type { RawRecord } from '../types';

// Division of Alcoholic Beverages and Tobacco daily activity (daily.csv, in the same allowed
// extracts folder; robots.txt checked 2026-10-17): every license action statewide on one day,
// so the source runs daily. We keep only new alcoholic beverage licenses (board 4006) whose
// application was approved or that were first issued: a sign of a new restaurant, bar or store.
// Transfers, renewals, liens and permits are dropped. The record names the business by its trade
// name, falling back to the license holder only when that is a company, never a person.

export const LIQUOR_FILE = /^daily\.csv$/i;

const COLUMNS = [
  'board',
  'county',
  'licenseNumber',
  'licenseType',
  'specialType',
  'dbaName',
  'licenseeName',
  'address1',
  'address2',
  'address3',
  'city',
  'state',
  'zip',
  'activityDate',
  'activityCode',
  'activity',
  'flag',
] as const;
export type LiquorRow = Record<(typeof COLUMNS)[number], string>;

/** New alcoholic beverage licenses: approvals and first permanent licenses. */
const NEW_LICENSE = /^(application approval|initial .*licensure)/i;

/** What a license series lets a business sell, in plain words (Chapter 561–565, F.S.). */
const LICENSE_TYPES: Record<string, string> = {
  '1APS': 'beer to take home',
  '2APS': 'beer and wine to take home',
  '3PS': 'beer, wine and liquor to take home',
  '1COP': 'beer served on site',
  '2COP': 'beer and wine served on site',
  '4COP': 'beer, wine and liquor served on site',
  '11C': 'a private club',
  '13CT': 'a caterer',
};

const COMPANY =
  /\b(LLC|L\.L\.C|INC|CORP|CORPORATION|CO|COMPANY|LP|LLP|LTD|GROUP|HOLDINGS|ENTERPRISES)\b\.?/i;

export function parseLiquorRow(line: string): LiquorRow | null {
  const fields = parseCsvLine(line).map((f) => f.trim());
  if (fields.length < COLUMNS.length) return null;
  return Object.fromEntries(COLUMNS.map((c, i) => [c, fields[i] ?? ''])) as LiquorRow;
}

/** A new alcoholic beverage license worth a line in the new-places roundup, else false. */
export function isNewLiquorLicense(row: LiquorRow): boolean {
  return row.board === '4006' && NEW_LICENSE.test(row.activity);
}

/** MM/DD/YYYY → Date (UTC midnight), or null. */
function parseDate(value: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  return m ? new Date(Date.UTC(+m[3]!, +m[1]! - 1, +m[2]!)) : null;
}

/** The business's public name: its trade name, or the license holder when that is a company. */
export function liquorBusinessName(row: LiquorRow): string | null {
  if (row.dbaName) return row.dbaName;
  return COMPANY.test(row.licenseeName) ? row.licenseeName : null;
}

export function liquorRecord(row: LiquorRow, fileUrl: string): RawRecord | null {
  const business = liquorBusinessName(row);
  if (!business) return null;
  const sells = LICENSE_TYPES[row.licenseType] ?? `license series ${row.licenseType}`;
  const street = [row.address1, row.address2, row.address3].filter(Boolean).join(', ');
  return {
    externalId: `abt:${row.licenseNumber}:${row.activityCode}:${row.activityDate}`,
    type: 'liquor_license',
    title: business,
    text: [
      `Business: ${business}`,
      `License: ${row.licenseType}${row.specialType ? ` ${row.specialType}` : ''} (${sells}), number ${row.licenseNumber}`,
      `Action: ${row.activity}, ${row.activityDate}`,
      `Location: ${street}, ${row.city}, ${row.state} ${row.zip}`,
    ].join('\n'),
    url: fileUrl,
    occurredAt: parseDate(row.activityDate),
    raw: {
      business,
      licenseNumber: row.licenseNumber,
      licenseType: row.licenseType,
      specialType: row.specialType,
      sells,
      activity: row.activity,
      activityCode: row.activityCode,
      activityDate: row.activityDate,
      street,
      city: row.city,
      zip: row.zip,
      county: row.county,
    },
  };
}
