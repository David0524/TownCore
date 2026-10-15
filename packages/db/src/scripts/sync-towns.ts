import { fileURLToPath } from 'node:url';
import { loadTowns } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { getDb } from '../client';
import { syncTowns } from '../towns';

loadDotEnv();
const townsDir = fileURLToPath(new URL('../../../../towns', import.meta.url));
const db = getDb();
try {
  const result = await syncTowns(db, loadTowns(townsDir));
  console.log(
    `Synced ${result.upserted.length} town(s): ${result.upserted.join(', ')}; ${result.sources} source(s), ${result.skippedSources} skipped (TBD)`,
  );
} finally {
  await db.$client.end();
}
