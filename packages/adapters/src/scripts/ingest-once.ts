// pnpm ingest:once [town-slug] [--kind <kind>]: ingest every source of a town (or all towns),
// or only sources of one kind (e.g. events), right now, live.
// Same code path as the worker's ingest job. In the cloud sandbox run with NODE_USE_ENV_PROXY=1.
import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { and, createDb, eq, sources, towns } from '@towncore/db';
import '../adapters';
import { Fetcher } from '../http/fetcher';
import { ingestSource } from '../ingest';
import { getAdapter, missingEnv } from '../registry';

loadDotEnv();
const args = process.argv.slice(2);
const kindAt = args.indexOf('--kind');
const kind = kindAt >= 0 ? args[kindAt + 1] : undefined;
const slug = args.find((a, i) => !a.startsWith('--') && (kindAt < 0 || i !== kindAt + 1));
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
const fetcher = new Fetcher();
try {
  const rows = await db
    .select({ source: sources, town: towns.slug })
    .from(sources)
    .innerJoin(towns, eq(sources.townId, towns.id))
    .where(
      and(
        slug ? eq(towns.slug, slug) : undefined,
        kind ? eq(sources.kind, kind as typeof sources.$inferSelect.kind) : undefined,
      ),
    );
  for (const { source, town } of rows) {
    const adapter = getAdapter(source.adapter);
    if (!adapter) {
      console.log(`${town} ${source.kind}/${source.platform}: no adapter, skipped`);
      continue;
    }
    const missing = missingEnv(adapter);
    if (missing.length > 0) {
      console.log(
        `${town} ${source.kind}/${source.platform}: needs ${missing.join(', ')}, skipped`,
      );
      continue;
    }
    const result = await ingestSource(db, source, adapter, fetcher);
    console.log(`${town} ${source.kind}/${source.platform}:`, result);
  }
} finally {
  await db.$client.end();
}
