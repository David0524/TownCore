// pnpm weather:once: refresh every town's Today weather tile now, live. Same code path as the
// worker's 15-minute job, plus the hourly tropics panel. In the cloud sandbox run with
// NODE_USE_ENV_PROXY=1.
import { Fetcher } from '@towncore/adapters';
import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb } from '@towncore/db';
import { pino } from 'pino';
import { refreshTropics, refreshWeather } from './weather';

loadDotEnv();
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
try {
  const fetcher = new Fetcher();
  const logger = pino({ level: 'warn' });
  console.log('weather refresh:', await refreshWeather(db, fetcher, logger));
  console.log('tropics refresh:', await refreshTropics(db, fetcher, logger));
} finally {
  await db.$client.end();
}
