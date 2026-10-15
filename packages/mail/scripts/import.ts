import { loadDotEnv } from '@towncore/config/dotenv';
import { getDb } from '@towncore/db';
import { runImportCommand } from '../src/cli/import';

loadDotEnv();
const db = getDb();
try {
  process.exitCode = await runImportCommand(process.argv.slice(2), {
    db,
    out: (line) => console.log(line),
  });
} finally {
  await db.$client.end();
}
