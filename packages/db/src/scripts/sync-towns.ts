import { fileURLToPath } from 'node:url';
import { loadTowns } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { getDb } from '../client';
import { syncTowns } from '../towns';

loadDotEnv();
const townsDir = fileURLToPath(new URL('../../../../towns', import.meta.url));
const db = getDb();
try {
  const { upserted } = await syncTowns(db, loadTowns(townsDir));
  console.log(`Synced ${upserted.length} town(s): ${upserted.join(', ')}`);
} finally {
  await db.$client.end();
}
