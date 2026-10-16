// pnpm launch "Delray Beach, FL" [--short-name Delray] [--nickname "Atlantic"] [--outlet "Name"]...
//   [--source kind=url]... [--site http://localhost:3000 [--chromium path]] [--resume] [--pick N] [--approve-spend]
// --preview (dry runs): past a failed readiness check, keep going to show the theme and report;
// the town still can't go live (Rule 7).
// Launches a town from an approved candidate (CLAUDE.md §10). A dry run unless --approve-spend:
// nothing is bought, sent or deployed. Step 2 proposes names and waits for --pick; a domain is
// bought only with --approve-spend and the domain typed back at the price shown (Rule 10).
import { createInterface } from 'node:readline/promises';
import { Fetcher } from '@towncore/adapters';
import { launchStepLabels, loadEnv, requireEnv, type LaunchStep } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb } from '@towncore/db';
import { providerFromEnv, resolveProviderName, type Llm } from '@towncore/pipeline';
import { LaunchRefused, resolveTown, runLaunch, statePlaces } from '../src';

loadDotEnv();
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flags = (name: string) =>
  args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]!] : []));
const VALUE_FLAGS = [
  '--domain',
  '--short-name',
  '--nickname',
  '--outlet',
  '--pick',
  '--source',
  '--site',
  '--chromium',
  '--redo',
];
const town = args.find(
  (a, i) => !a.startsWith('--') && a.includes(',') && !VALUE_FLAGS.includes(args[i - 1] ?? ''),
);
if (!town) {
  console.error(
    'Usage: pnpm launch "Town, ST" [--short-name X] [--nickname X] [--outlet "Name"]... [--source kind=url]... [--resume] [--pick N] [--approve-spend]',
  );
  process.exit(1);
}

/** The operator types the domain back to approve its price. Never without a terminal. */
async function confirmPurchase(q: { domain: string; price: number; renewalPrice: number }) {
  if (!process.stdin.isTTY) {
    console.error('Buying a domain needs a terminal to confirm it; nothing was bought.');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(
      `\nBuy ${q.domain} for $${q.price} (renews at $${q.renewalPrice}/year, auto-renew on)?`,
    );
    const typed = await rl.question(`Type the domain to buy it, anything else to cancel: `);
    return typed.trim().toLowerCase() === q.domain;
  } finally {
    rl.close();
  }
}

const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
try {
  const fetcher = new Fetcher({ timeoutMs: 15 * 60_000 });
  const domain = flag('domain');
  const shortName = flag('short-name');
  const nickname = flag('nickname');
  const outlets = flags('outlet');
  const sources = flags('source');
  // Discovery and readiness use the model when one is configured (D-M7-2); without one, step 3
  // verifies --source flags and the state sources only.
  let llm: Llm | undefined;
  if (resolveProviderName()) {
    const { name, provider } = providerFromEnv();
    llm = { providerName: name, provider, db };
  }
  const pick = flag('pick');
  if (pick !== undefined && !/^[1-9]$/.test(pick))
    throw new LaunchRefused('--pick takes 1, 2 or 3.');
  const result = await runLaunch(
    {
      db,
      resolve: (t) => resolveTown(t, { fetcher }),
      fetcher,
      ...(llm ? { llm } : {}),
      // Step 6b screenshots the draft town on a running web app (pnpm --filter web start).
      ...(flag('site')
        ? {
            shots: {
              siteUrl: flag('site')!,
              ...(flag('chromium') ? { executablePath: flag('chromium')! } : {}),
            },
          }
        : {}),
      names: {
        fetcher,
        places: (state) => statePlaces(state, { fetcher }),
        // Only the string settings (registrar token, team, registrant contact) are read.
        env: Object.fromEntries(
          Object.entries(loadEnv()).filter((e): e is [string, string] => typeof e[1] === 'string'),
        ),
        confirmPurchase,
      },
    },
    {
      town,
      ...(domain ? { domain } : {}),
      ...(shortName ? { shortName } : {}),
      ...(nickname ? { nickname } : {}),
      ...(outlets.length ? { outlets } : {}),
      ...(sources.length ? { sources } : {}),
      ...(pick ? { pick: Number(pick) } : {}),
      approveSpend: args.includes('--approve-spend'),
      ...(args.includes('--preview') ? { preview: true } : {}),
      ...(flag('redo') ? { redo: flag('redo') as LaunchStep } : {}),
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
