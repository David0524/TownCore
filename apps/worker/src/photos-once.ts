// pnpm photos:once [town-slug]: give guides their stock photos now (all towns, or one), all of
// them rather than the worker's 10 per run. Same code as the worker's 30-minute job. Needs
// UNSPLASH_ACCESS_KEY; in the cloud sandbox run with NODE_USE_ENV_PROXY=1.
import { Fetcher } from '@towncore/adapters';
import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb, getTownBySlug } from '@towncore/db';
import { pino } from 'pino';
import { drawStockPhotos, unsplashFromEnv } from './photos';

loadDotEnv();
const unsplash = unsplashFromEnv();
if (!unsplash) throw new Error('Set UNSPLASH_ACCESS_KEY first.');
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
try {
  const slug = process.argv[2];
  const town = slug ? await getTownBySlug(db, slug) : null;
  if (slug && !town) throw new Error(`unknown town: ${slug}`);
  const result = await drawStockPhotos(db, new Fetcher(), unsplash, pino(), {
    limit: 1000,
    townId: town?.id,
  });
  console.log('stock photos:', result);
} finally {
  await db.$client.end();
}
