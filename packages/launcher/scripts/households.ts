// pnpm towns:households [--census]
// Fills each town's household count (ACS B11001) for subscribers per 1,000 households on
// Admin → Health. Without --census it copies the figure from the town's ranking; with it, it
// reads the Census ACS file (downloaded once, then cached).
import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb } from '@towncore/db';
import { fillHouseholds } from '../src';

loadDotEnv();
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
try {
  const census = process.argv.includes('--census');
  const { updated, missing } = await fillHouseholds(db, { census });
  for (const u of updated)
    console.log(`${u.slug}: ${u.households.toLocaleString('en-US')} households (${u.from})`);
  if (missing.length > 0)
    console.log(
      `No figure for: ${missing.join(', ')}.${census ? '' : ' Run with --census to read the ACS file.'}`,
    );
} finally {
  await db.$client.end();
}
