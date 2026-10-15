// Seeds the fictional fixture towns (e2e/fixtures/towns) plus clearly labeled [TEST] articles
// for Boca and the fixtures, for dev and CI. Only runs against a local database unless
// --allow-remote-db is passed, so test content can't reach production by accident.
import { fileURLToPath } from 'node:url';
import { loadTowns, requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb, getTownBySlug, syncTowns } from '@towncore/db';
import { seedTestContent } from './test-content';

loadDotEnv();
const databaseUrl = requireEnv('DATABASE_URL');
const host = new URL(databaseUrl).hostname;
if (
  !['localhost', '127.0.0.1', '::1'].includes(host) &&
  !process.argv.includes('--allow-remote-db')
) {
  throw new Error(`Refusing to seed test content into a non-local database (${host}).`);
}

const fixturesDir = fileURLToPath(new URL('../e2e/fixtures/towns', import.meta.url));
const db = createDb(databaseUrl, { max: 1 });
try {
  const { upserted } = await syncTowns(db, loadTowns(fixturesDir));
  console.log(`Seeded fixture town(s): ${upserted.join(', ')}`);
  for (const slug of ['boca-raton', ...upserted]) {
    const town = await getTownBySlug(db, slug);
    if (!town) throw new Error(`Town ${slug} not found; run towns:sync first.`);
    await seedTestContent(db, town);
    console.log(`Seeded test articles for ${slug}`);
  }
} finally {
  await db.$client.end();
}
