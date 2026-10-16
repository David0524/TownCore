import { parseCsvLine } from '../lib/csv';
import type { RawRecord } from '../types';
import { foodViolations } from './violations';

// Florida DBPR Division of Hotels and Restaurants: food service inspections for the current
// fiscal year, one file per district (1fdinspi.csv … 7fdinspi.csv; Palm Beach, Broward and
// Martin are district 2), refreshed weekly. Layout "Hotels and Restaurants Inspection Files,
// Extracts After 1/1/2013" from the division's public records page, verified against the live
// files on 2026-10-16: https://www2.myfloridalicense.com/hotels-restaurants/public-records/
// The files have a header row. Each row is one inspection visit, with a count per violation
// category (01–58), not the inspector's notes. Rows are filtered on the location city.

export const INSPECTION_FILE = /^[1-7]fdinspi\.csv$/;

export type InspectionRow = {
  county: string;
  licenseType: string;
  licenseNumber: string;
  business: string;
  address: string;
  city: string;
  zip: string;
  inspectionNumber: string;
  visit: number;
  inspectionType: string;
  disposition: string;
  date: string;
  total: number;
  highPriority: number;
  intermediate: number;
  basic: number;
  /** Violation category ("03") → how many were cited. Only categories with any. */
  violations: Record<string, number>;
  visitId: string;
};

const num = (v: string | undefined) => {
  const n = Number((v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
};

export function parseInspectionRow(line: string): InspectionRow | null {
  const f = parseCsvLine(line).map((v) => v.trim());
  // Data rows start with the district ("D2"); the header row starts with "District".
  if (f.length < 80 || !/^D\d$/.test(f[0] ?? '')) return null;
  const violations: Record<string, number> = {};
  for (let i = 1; i <= 58; i++) {
    const count = num(f[21 + i]);
    if (count > 0) violations[String(i).padStart(2, '0')] = count;
  }
  return {
    county: f[2]!,
    licenseType: f[3]!,
    licenseNumber: f[4]!,
    business: f[5]!,
    address: f[6]!,
    city: f[7]!,
    zip: f[8]!,
    inspectionNumber: f[9]!,
    visit: num(f[10]),
    inspectionType: f[12]!,
    disposition: f[13]!,
    date: f[14]!,
    total: num(f[17]),
    highPriority: num(f[18]),
    intermediate: num(f[19]),
    basic: num(f[20]),
    violations,
    visitId: f[81] ?? '',
  };
}

/** MM/DD/YYYY → Date (UTC midnight), or null. */
function parseDate(value: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  return m ? new Date(Date.UTC(+m[3]!, +m[1]! - 1, +m[2]!)) : null;
}

/**
 * Outcomes that mean the inspector found a problem serious enough for enforcement: an emergency
 * closure order or an administrative complaint (and their failed call-backs). Stories about these
 * are Tier 3 (§7: inspection failures need human approval).
 */
export function inspectionSeverity(
  disposition: string,
): 'closure' | 'complaint' | 'warning' | 'ok' {
  const d = disposition.toLowerCase();
  if (/emergency order/.test(d)) {
    if (/not complied/.test(d)) return 'closure';
    if (/complied/.test(d)) return 'ok';
    return /extension/.test(d) ? 'warning' : 'closure';
  }
  if (/admin(istrative|\.) complaint/.test(d)) return 'complaint';
  if (/warning|extension|not complied/.test(d)) return 'warning';
  return 'ok';
}

export function inspectionRecord(row: InspectionRow, fileUrl: string): RawRecord {
  const cited = Object.entries(row.violations)
    .map(([code, count]) => {
      const name = foodViolations[code]?.name ?? `Category ${code}`;
      return `${name}${count > 1 ? ` (${count})` : ''}`;
    })
    .join('; ');
  const visit = row.visit > 1 ? `call-back visit ${row.visit}` : row.inspectionType.toLowerCase();
  return {
    externalId: `inspection:${row.visitId || `${row.inspectionNumber}-${row.visit}`}`,
    type: 'inspection',
    title: row.business,
    text: [
      `Florida food service inspection (${visit}) on ${row.date} at ${row.business}, ${row.address}, ${row.city} ${row.zip}; license ${row.licenseNumber}.`,
      `Result: ${row.disposition}.`,
      `Violations cited: ${row.total} (${row.highPriority} high priority, ${row.intermediate} intermediate, ${row.basic} basic).`,
      cited ? `Categories cited: ${cited}.` : null,
    ]
      .filter(Boolean)
      .join(' '),
    url: fileUrl,
    occurredAt: parseDate(row.date),
    raw: { ...row, severity: inspectionSeverity(row.disposition) },
  };
}
