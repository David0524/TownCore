// pnpm sources:status: health of every source, per town (docs/plans/M2.md §5).
import type { SourceKind } from '@towncore/config';
import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb, eq, sources, towns } from '@towncore/db';
import { defaultSchedule } from '../schedule';

loadDotEnv();
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
try {
  const rows = await db
    .select({ town: towns.slug, source: sources })
    .from(sources)
    .innerJoin(towns, eq(sources.townId, towns.id))
    .orderBy(towns.slug, sources.kind);
  if (rows.length === 0)
    console.log('No sources yet. Add verified sources to towns/*.yaml and run pnpm towns:sync.');
  console.table(
    rows.map(({ town, source }) => ({
      town,
      kind: source.kind,
      platform: source.platform,
      health: source.health,
      every:
        source.schedule ??
        defaultSchedule(source.kind as SourceKind, source.platform, source.config),
      lastOk: source.lastOkAt?.toISOString() ?? '-',
      failures: source.consecutiveFailures,
      lastError: source.lastError?.slice(0, 60) ?? '',
    })),
  );
} finally {
  await db.$client.end();
}
