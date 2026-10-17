// pnpm cohort advance [<cohort name>]
// Runs the cohort orchestrator once, here, the same chain the worker runs every 5 minutes when
// COHORT_ORCHESTRATOR=worker (docs/plans/agentic-ops.md). Run it from a Claude Code session so the
// launch files (town YAML, theme, launch report) land in the repo for a pull request (D-M7-9).
// Buying happens only under a cohort's approval in Admin → Launches (Rule 10).
import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb, eq, launchCohorts } from '@towncore/db';
import { advanceCohort, advanceCohorts, cohortDepsFromEnv } from '../src';

loadDotEnv();
const [command, name] = process.argv.slice(2);
if (command !== 'advance') {
  console.error('Usage: pnpm cohort advance [<cohort name>]');
  process.exit(1);
}
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
try {
  const deps = cohortDepsFromEnv(db, { log: (m, d) => console.log(m, d ?? '') });
  if (name) {
    const [cohort] = await db.select().from(launchCohorts).where(eq(launchCohorts.name, name));
    if (!cohort) throw new Error(`No cohort named ${name}.`);
    console.log((await advanceCohort(deps, cohort.id)) ? 'Advanced.' : 'Another run holds it.');
  } else console.log(`Advanced ${await advanceCohorts(deps)} cohort(s).`);
} finally {
  await db.$client.end();
}
