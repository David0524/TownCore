// pnpm directory:seed <town-slug> [--geocode N]: build the town's directory from its ingested
// state license records now (the worker does this daily), then optionally geocode up to N
// listings. Same code path as the worker. In the cloud sandbox run with NODE_USE_ENV_PROXY=1.
import { Fetcher } from '@towncore/adapters';
import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb, eq, towns } from '@towncore/db';
import { geocodeListings, seedDirectory } from '../src';

loadDotEnv();
const [slug, flag, count] = process.argv.slice(2);
if (!slug || (flag && flag !== '--geocode'))
  throw new Error('usage: pnpm directory:seed <town-slug> [--geocode N]');
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
try {
  const [town] = await db.select().from(towns).where(eq(towns.slug, slug));
  if (!town) throw new Error(`unknown town: ${slug}`);
  console.log('seed:', await seedDirectory(db, town.id));
  if (flag) {
    const limit = Number(count ?? 50);
    console.log('geocode:', await geocodeListings(db, new Fetcher(), town.id, { limit }));
  }
} finally {
  await db.$client.end();
}
