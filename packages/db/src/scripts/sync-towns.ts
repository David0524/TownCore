import { fileURLToPath } from 'node:url';
import { loadDotEnv, loadTownConfigs } from '@towncore/config';
import { getDb } from '../client.js';
import { syncTowns } from '../towns.js';

loadDotEnv();
const townsDir = fileURLToPath(new URL('../../../../towns', import.meta.url));
const db = getDb();
try {
  const { upserted } = await syncTowns(db, loadTownConfigs(townsDir));
  console.log(`Synced ${upserted.length} town(s): ${upserted.join(', ')}`);
} finally {
  await db.$client.end();
}
