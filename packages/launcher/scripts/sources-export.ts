// pnpm sources:export [--dry-run]
// Writes sources approved in Admin → Proposals into their town YAML files, for a pull request
// from a Claude Code session (docs/plans/agentic-ops.md). Lists approved adapter requests too.
import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb } from '@towncore/db';
import { exportApprovedSources } from '../src';

loadDotEnv();
const dryRun = process.argv.includes('--dry-run');
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
try {
  const result = await exportApprovedSources(db, { dryRun });
  for (const w of result.written)
    console.log(`${dryRun ? 'Would write' : 'Wrote'} ${w.file} (${w.town}): ${w.added.join('; ')}`);
  for (const m of result.missing) console.log(`Skipped ${m.town}: ${m.reason}`);
  if (result.adapterRequests.length) {
    console.log('\nApproved adapter requests (build each in a Claude Code session, CLAUDE.md §9):');
    for (const a of result.adapterRequests)
      console.log(`- ${a.town}: ${a.kind} at ${a.url} (${a.platform ?? 'unknown platform'})`);
  }
  if (!result.written.length && !result.adapterRequests.length)
    console.log('Nothing approved is waiting to be exported.');
} finally {
  await db.$client.end();
}
