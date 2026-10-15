// pnpm ingest:once [town-slug]: ingest every source of a town (or all towns) right now, live.
// Same code path as the worker's ingest job. In the cloud sandbox run with NODE_USE_ENV_PROXY=1.
import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb, eq, sources, towns } from '@towncore/db';
import '../adapters';
import { Fetcher } from '../http/fetcher';
import { ingestSource } from '../ingest';
import { getAdapter } from '../registry';

loadDotEnv();
const slug = process.argv[2];
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
const fetcher = new Fetcher();
try {
  const rows = await db
    .select({ source: sources, town: towns.slug })
    .from(sources)
    .innerJoin(towns, eq(sources.townId, towns.id))
    .where(slug ? eq(towns.slug, slug) : undefined);
  for (const { source, town } of rows) {
    const adapter = getAdapter(source.adapter);
    if (!adapter) {
      console.log(`${town} ${source.kind}/${source.platform}: no adapter, skipped`);
      continue;
    }
    const result = await ingestSource(db, source, adapter, fetcher);
    console.log(`${town} ${source.kind}/${source.platform}:`, result);
  }
} finally {
  await db.$client.end();
}
