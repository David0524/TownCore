import { loadEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { getDb } from '@towncore/db';
import { runOnboardCommand } from '../src/cli/onboard';

loadDotEnv();
const db = getDb();
try {
  process.exitCode = await runOnboardCommand(process.argv.slice(2), {
    db,
    env: loadEnv(),
    out: (line) => console.log(line),
  });
} finally {
  await db.$client.end();
}
