// pnpm demo:migrate | pnpm demo:sync <since ISO> <table[:timestamp column]>...
//
// The Vercel demo's database (Neon) until the worker and production run: apply new migrations
// and copy rows changed locally since a cutoff (upsert by primary key). It talks to Neon's HTTPS
// SQL endpoint, so it works where Postgres connections can't be opened (cloud sessions; there run
// with NODE_USE_ENV_PROXY=1). Replaces the session scratch scripts (owner, 2026-10-17: manual steps
// become commands). Needs DEMO_DATABASE_URL (the demo's connection string) and DATABASE_URL (local).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb } from '../client';
import { migrationsFolder } from '../migrate';

loadDotEnv();
const demoUrl = requireEnv('DEMO_DATABASE_URL');
const endpoint = `https://${new URL(demoUrl).hostname}/sql`;

type Result = { rows: Record<string, unknown>[] };

/** One statement on the demo database, with $1… parameters. */
async function demo(query: string, params: unknown[] = []): Promise<Result> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Neon-Connection-String': demoUrl, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, params }),
  });
  if (!response.ok)
    throw new Error(`demo SQL failed: HTTP ${response.status} ${await response.text()}`);
  return (await response.json()) as Result;
}

/** Applies repo migrations newer than the demo's Drizzle history, with drizzle-kit's bookkeeping. */
async function migrateDemo() {
  const [{ m } = { m: 0 }] = (
    await demo('select coalesce(max(created_at), 0)::bigint as m from drizzle.__drizzle_migrations')
  ).rows as { m: number }[];
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  ) as {
    entries: { tag: string; when: number }[];
  };
  const pending = journal.entries.filter((e) => e.when > Number(m));
  for (const entry of pending) {
    const raw = readFileSync(join(migrationsFolder, `${entry.tag}.sql`));
    for (const statement of raw.toString().split('--> statement-breakpoint')) {
      if (statement.trim()) await demo(statement);
    }
    await demo('insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)', [
      createHash('sha256').update(raw).digest('hex'),
      entry.when,
    ]);
    console.log('applied', entry.tag);
  }
  console.log(`demo database up to date; ${pending.length} applied`);
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** Copies local rows changed since `since` (by a timestamp column, or the whole table) to the demo. */
async function syncDemo(since: string, specs: string[]) {
  if (Number.isNaN(Date.parse(since))) throw new Error(`Not a date: ${since}`);
  const local = createDb(requireEnv('DATABASE_URL'), { max: 1 });
  try {
    for (const spec of specs) {
      const [table = '', column] = spec.split(':');
      if (!IDENT.test(table) || (column && !IDENT.test(column)))
        throw new Error(`Bad table spec: ${spec}`);
      const pk = (
        await local.$client.unsafe(
          `select a.attname as name from pg_index i join pg_attribute a
           on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
           where i.indrelid = 'public."${table}"'::regclass and i.indisprimary`,
        )
      ).map((r) => String(r.name));
      const cols = (
        await local.$client.unsafe(
          `select column_name as name from information_schema.columns
           where table_schema = 'public' and table_name = $1 order by ordinal_position`,
          [table],
        )
      ).map((r) => String(r.name));
      const sets = cols
        .filter((c) => !pk.includes(c))
        .map((c) => `"${c}" = excluded."${c}"`)
        .join(', ');
      const where = column ? `where "${column}" >= $1` : '';
      const args = column ? [since] : [];
      const order = pk.map((c) => `"${c}"`).join(', ');
      let copied = 0;
      for (let offset = 0; ; offset += 300) {
        const rows = await local.$client.unsafe(
          `select * from public."${table}" ${where} order by ${order} limit 300 offset ${offset}`,
          args,
        );
        if (rows.length === 0) break;
        await demo(
          `insert into public."${table}" select * from json_populate_recordset(null::public."${table}", $1::json)
           on conflict (${order}) do ${sets ? `update set ${sets}` : 'nothing'}`,
          [JSON.stringify(rows)],
        );
        copied += rows.length;
      }
      console.log(`${table}: ${copied}`);
    }
  } finally {
    await local.$client.end();
  }
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'migrate') await migrateDemo();
else if (command === 'sync' && rest.length >= 2) await syncDemo(rest[0]!, rest.slice(1));
else {
  console.error('usage: pnpm demo:migrate | pnpm demo:sync <since ISO> <table[:column]>...');
  process.exit(1);
}
