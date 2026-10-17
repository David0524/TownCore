import { Fetcher } from '@towncore/adapters';
import { loadEnv } from '@towncore/config';
import type { Db } from '@towncore/db';
import { onboardLaunchDomain } from '@towncore/mail';
import { providerFromEnv, resolveProviderName, type Llm } from '@towncore/pipeline';
import { statePlaces } from './towns-rank';
import type { CohortDeps } from './cohort-run';
import { domainOrder } from './domains';
import { runLaunch } from './launch';
import { resolveTown } from './resolve';

// The orchestrator's real dependencies, from the environment: the same launch run, registrar
// and mail onboarding as `pnpm launch` and `pnpm mail:onboard`. Used by the worker and by
// `pnpm cohort advance`.

export function cohortDepsFromEnv(
  db: Db,
  opts: { fetcher?: Fetcher; llm?: Llm; log?: CohortDeps['log'] } = {},
): CohortDeps {
  const env = loadEnv();
  const fetcher = opts.fetcher ?? new Fetcher({ timeoutMs: 15 * 60_000 });
  let llm = opts.llm;
  if (!llm && resolveProviderName()) {
    const { name, provider } = providerFromEnv();
    llm = { providerName: name, provider, db };
  }
  // Only the string settings (registrar token, team, registrant contact) are read.
  const strings = Object.fromEntries(
    Object.entries(env).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
  const token = env.REGISTRAR_API_KEY;
  return {
    db,
    launch: (options, purchase) =>
      runLaunch(
        {
          db,
          resolve: (t) => resolveTown(t, { fetcher }),
          fetcher,
          ...(llm ? { llm } : {}),
          names: {
            fetcher,
            places: (state) => statePlaces(state, { fetcher }),
            env: strings,
            // No terminal here: only the admin's cohort approval can say yes (Rule 10).
            confirmPurchase: purchase?.confirm ?? (async () => false),
          },
        },
        options,
      ),
    onboard: (spec, o) => onboardLaunchDomain(db, env, spec, o),
    ...(token
      ? {
          orderStatus: (orderId: string) =>
            domainOrder(fetcher, {
              token,
              ...(env.VERCEL_TEAM_ID ? { teamId: env.VERCEL_TEAM_ID } : {}),
              orderId,
            }),
        }
      : {}),
    ...(opts.log ? { log: opts.log } : {}),
  };
}
