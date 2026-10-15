// pnpm weather:once: refresh every town's Today weather tile now, live. Same code path as the
// worker's 15-minute job. In the cloud sandbox run with NODE_USE_ENV_PROXY=1.
import { Fetcher } from '@towncore/adapters';
import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb } from '@towncore/db';
import { pino } from 'pino';
import { refreshWeather } from './weather';

loadDotEnv();
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
try {
  const result = await refreshWeather(db, new Fetcher(), pino({ level: 'warn' }));
  console.log('weather refresh:', result);
} finally {
  await db.$client.end();
}
