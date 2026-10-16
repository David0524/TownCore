import { parseCsvLine } from '../lib/csv';
import type { RawRecord } from '../types';

// Florida DBPR Division of Hotels and Restaurants: active food service licensees, one file per
// district (hrfood1.csv … hrfood7.csv; Palm Beach, Broward and Martin are district 2). Layout
// "Hotels and Restaurants Active Licensure Base" from the division's public records page,
// verified against the live files on 2026-10-15:
// https://www2.myfloridalicense.com/hotels-restaurants/public-records/
// Unlike the professional licensee files these have a header row, and both a mailing and a
// location address. Rows are filtered on the location city.

export const FOOD_FILE = /^hrfood[1-7]\.csv$/;
/**
 * New establishments approved this fiscal year, statewide (newfood.csv): the same layout with
 * three leading columns (application number, type and approval date). These are dated, so they
 * feed "new places to eat"; the hrfood files carry no first-licensed date.
 */
export const NEW_FOOD_FILE = /^newfood\.csv$/;

const COLUMNS = [
  'board',
  'licenseType',
  'licenseeName',
  'rank',
  'modifier',
  'mailingName',
  'mailingAddress1',
  'mailingAddress2',
  'mailingAddress3',
  'mailingCity',
  'mailingState',
  'mailingZip',
  'primaryPhone',
  'mailingCountyCode',
  'businessName',
  'filler',
  'address1',
  'address2',
  'address3',
  'city',
  'state',
  'zip',
  'countyCode',
  'county',
  'secondaryPhone',
  'district',
  'region',
  'licenseNumber',
  'primaryStatus',
  'secondaryStatus',
  'expirationDate',
  'lastInspectionDate',
  'seats',
  'baseRiskLevel',
  'secondaryRiskLevel',
] as const;
export type FoodRow = Record<(typeof COLUMNS)[number], string>;

/** License type and rank codes, from the same page ("Public Food Service License Type and Rank Codes"). */
export const foodLicenseTypes: Record<string, string> = {
  '2010:SEAT': 'Permanent Food Service, seating',
  '2010:NOST': 'Permanent Food Service, non-seating',
  '2012:PARK': 'Theme Park Food Cart',
  '2013:CATR': 'Catering',
  '2014:MFDV': 'Mobile Food Dispensing Vehicle',
  '2014:HTDG': 'Hot Dog Cart',
  '2015:VEND': 'Vending Machine',
  '2016:TEMP': 'Temporary Event Vendor',
};

export function parseFoodRow(line: string): FoodRow | null {
  const fields = parseCsvLine(line);
  // Data rows start with board 200 (Hotels and Restaurants); this skips the header row.
  if (fields.length < 31 || fields[0]?.trim() !== '200') return null;
  return Object.fromEntries(COLUMNS.map((c, i) => [c, (fields[i] ?? '').trim()])) as FoodRow;
}

export type NewFoodRow = FoodRow & {
  applicationNumber: string;
  applicationType: string;
  approvedDate: string;
};

export function parseNewFoodRow(line: string): NewFoodRow | null {
  const fields = parseCsvLine(line);
  if (fields.length < 34 || fields[3]?.trim() !== '200') return null;
  const [applicationNumber = '', applicationType = '', approvedDate = '', ...rest] = fields.map(
    (f) => f.trim(),
  );
  const row = Object.fromEntries(COLUMNS.map((c, i) => [c, rest[i] ?? ''])) as FoodRow;
  return { ...row, applicationNumber, applicationType, approvedDate };
}

/** MM/DD/YYYY → Date (UTC midnight), or null. */
function parseDate(value: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  return m ? new Date(Date.UTC(+m[3]!, +m[1]! - 1, +m[2]!)) : null;
}

export function newFoodRecord(row: NewFoodRow, fileUrl: string): RawRecord {
  const base = foodRecord(row, fileUrl);
  return {
    ...base,
    externalId: `newfood:${row.applicationNumber}`,
    type: 'new_food_license',
    text: `${base.text} Application approved ${row.approvedDate}.`,
    occurredAt: parseDate(row.approvedDate),
    raw: {
      ...(base.raw as object),
      applicationNumber: row.applicationNumber,
      applicationType: row.applicationType,
      approvedDate: row.approvedDate,
    },
  };
}

export function foodRecord(row: FoodRow, fileUrl: string): RawRecord {
  const occupation =
    foodLicenseTypes[`${row.licenseType}:${row.rank}`] ?? `Food service (${row.licenseType})`;
  const business = row.businessName || row.licenseeName;
  const street = [row.address1, row.address2, row.address3].filter(Boolean).join(', ');
  return {
    // The license number is unique per license type and location.
    externalId: `food:${row.licenseNumber}`,
    // Its own type, so food licenses never land in the weekly contractor-license roundup.
    type: 'food_license',
    title: business,
    text: [
      `${occupation}, license ${row.licenseNumber}.`,
      `Licensee: ${row.licenseeName}${business !== row.licenseeName ? `, doing business as ${business}` : ''}.`,
      `Location: ${street}, ${row.city}, ${row.state} ${row.zip}.`,
      row.expirationDate ? `Expires ${row.expirationDate}.` : null,
    ]
      .filter(Boolean)
      .join(' '),
    url: fileUrl,
    // The file has no first-licensed date; new establishments come from a separate extract.
    occurredAt: null,
    raw: { ...row, occupation },
  };
}
