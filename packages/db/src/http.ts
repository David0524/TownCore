import { drizzle } from 'drizzle-orm/pg-proxy';
import type { Db } from './client';
import * as schema from './schema';

// A Drizzle database over Neon's HTTPS SQL endpoint, for the Vercel demo's database where a
// Postgres connection can't be opened (cloud sessions; run with NODE_USE_ENV_PROXY=1). Same
// schema and queries as `createDb`; no transactions. Until the worker and production run.

/** One statement over HTTP: the rows as arrays (`all`) or objects (`execute`), as text. */
export type SqlTransport = (
  query: string,
  params: Array<string | null>,
  arrayMode: boolean,
) => Promise<{ rows: unknown[]; fields: Array<{ dataTypeID: number }> }>;

/** Neon's `/sql` endpoint for a connection string. */
export function neonTransport(connectionString: string): SqlTransport {
  const endpoint = `https://${new URL(connectionString).hostname}/sql`;
  return async (query, params, arrayMode) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Neon-Connection-String': connectionString,
        'Neon-Array-Mode': String(arrayMode),
        'Neon-Raw-Text-Output': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, params }),
    });
    if (!response.ok)
      throw new Error(`SQL over HTTP failed: HTTP ${response.status} ${await response.text()}`);
    return (await response.json()) as { rows: unknown[]; fields: Array<{ dataTypeID: number }> };
  };
}

/** A parameter as Postgres text: arrays as array literals, objects as JSON. */
export function toParam(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const items = value.map((v) => {
      const text = toParam(v);
      return text === null ? 'NULL' : `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    });
    return `{${items.join(',')}}`;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const BOOL = 16;
const BOOL_ARRAY = 1000;
const JSON_TYPES = new Set([114, 3802]);

/**
 * Text values as the postgres.js driver would give them, where Drizzle doesn't convert: booleans
 * and JSON. Everything else (numbers, dates, arrays) Drizzle maps from text itself.
 */
export function fromText(value: unknown, dataTypeID: number): unknown {
  if (value === null || typeof value !== 'string') return value;
  if (dataTypeID === BOOL) return value === 't' || value === 'true';
  if (JSON_TYPES.has(dataTypeID)) return JSON.parse(value) as unknown;
  if (dataTypeID === BOOL_ARRAY) {
    return value
      .slice(1, -1)
      .split(',')
      .filter(Boolean)
      .map((v) => v === 't' || v === 'true');
  }
  return value;
}

export function createHttpDb(transport: SqlTransport): Db {
  const db = drizzle(
    async (query, params, method) => {
      const arrayMode = method === 'all';
      const { rows, fields } = await transport(query, params.map(toParam), arrayMode);
      return {
        rows: rows.map((row) =>
          arrayMode
            ? (row as unknown[]).map((v, i) => fromText(v, fields[i]?.dataTypeID ?? 0))
            : row,
        ),
      };
    },
    { schema, casing: 'snake_case' },
  );
  // Shares the postgres.js database's query API; callers that need `$client` (raw SQL, ending
  // the pool) can't use it.
  return db as unknown as Db;
}
