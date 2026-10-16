// pnpm maps:once [town-slug]: refresh base maps from Geofabrik now (all towns, or one), then
// draw maps for eligible stories. Same code as the worker's monthly and 30-minute jobs. In the
// cloud sandbox run with NODE_USE_ENV_PROXY=1; download.geofabrik.de must be allowed.
import { Fetcher } from '@towncore/adapters';
import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb } from '@towncore/db';
import { pino } from 'pino';
import { drawMaps, refreshBasemaps } from './maps';

loadDotEnv();
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
const logger = pino({ level: 'info' });
try {
  console.log('base maps:', await refreshBasemaps(db, logger, { slug: process.argv[2] }));
  console.log('maps:', await drawMaps(db, new Fetcher(), logger));
} finally {
  await db.$client.end();
}
