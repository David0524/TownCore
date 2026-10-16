import type { SourceKind } from '@towncore/config';

// Shared by the open-data adapters (Socrata, ArcGIS): one dataset row → one record, through a
// per-source field map, since every city names its columns differently.

export type Row = Record<string, unknown>;

/** A row value as plain text: dates as YYYY-MM-DD, numbers as written, objects skipped. */
export function cell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** "{permit_type} at {address}" with each field's value; missing fields drop out cleanly. */
export function fillTemplate(template: string, row: Row, format = cell): string {
  return (
    template
      .replace(/\{([^}]+)\}/g, (_, name: string) => format(row[name.trim()]) ?? '')
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.;:])/g, '$1')
      // A colon left with nothing after it before a joining word: "Roof: at 1 Main St".
      .replace(/:\s+(at|in|on|for|by)\b/g, ' $1')
      .replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, '')
      .trim()
  );
}

/**
 * "Label: value" lines. `fields` maps column → label; without it, every non-empty scalar column
 * is listed under its own name (capped, so a wide table doesn't flood the record).
 */
export function rowText(
  row: Row,
  fields: Record<string, string> | null,
  format = cell,
  max = 25,
): string {
  const entries: [string, string][] = fields
    ? Object.entries(fields).map(([column, label]) => [label, format(row[column]) ?? ''])
    : Object.entries(row)
        .filter(([column]) => !column.startsWith(':') && !column.startsWith('@'))
        .map(([column, value]) => [column, format(value) ?? '']);
  return entries
    .filter(([, value]) => value)
    .slice(0, max)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}

/** The record type for a dataset row, from the source kind unless the config names one. */
export function rowType(kind: SourceKind, configured: unknown): string {
  if (typeof configured === 'string' && configured) return configured;
  switch (kind) {
    case 'permits':
      return 'permit';
    case 'inspections':
      return 'inspection';
    case 'police':
    case 'fire':
      return 'incident';
    case 'property_sales':
      return 'sale';
    case 'business_filings':
      return 'license';
    default:
      return 'dataset-row';
  }
}

/** A `{ column: label }` map from source config, or null. */
export function fieldMap(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && v) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}
