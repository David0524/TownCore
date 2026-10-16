// pnpm launch "Delray Beach, FL" [--domain delraytownsquare.com] [--approve-spend] [--resume]
// Launches a town from an approved candidate (CLAUDE.md §10). A dry run unless --approve-spend:
// nothing is bought, sent or deployed. Steps not built yet stop the run with that reason.
import { launchStepLabels, requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb } from '@towncore/db';
import { LaunchRefused, resolveTown, runLaunch } from '../src';

loadDotEnv();
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const town = args.find((a) => !a.startsWith('--') && a.includes(','));
if (!town) {
  console.error(
    'Usage: pnpm launch "Town, ST" [--domain example.com] [--approve-spend] [--resume]',
  );
  process.exit(1);
}
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
try {
  const domain = flag('domain');
  const result = await runLaunch(
    { db, resolve: (t) => resolveTown(t) },
    {
      town,
      ...(domain ? { domain } : {}),
      approveSpend: args.includes('--approve-spend'),
      resume: args.includes('--resume'),
    },
  );
  const { launch, steps, files } = result;
  console.log(
    `${launch.name}, ${launch.state}: ${launch.status}${launch.dryRun ? ' (dry run)' : ''}`,
  );
  for (const s of steps)
    console.log(
      `  ${s.status.padEnd(7)} ${launchStepLabels[s.step as keyof typeof launchStepLabels]}${s.error ? `: ${s.error}` : ''}`,
    );
  if (launch.stoppedReason) console.log(`Stopped: ${launch.stoppedReason}`);
  for (const f of files) console.log(`Wrote ${f}`);
} catch (error) {
  if (error instanceof LaunchRefused) {
    console.error(error.message);
    process.exitCode = 1;
  } else throw error;
} finally {
  await db.$client.end();
}
