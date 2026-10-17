import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnoseBrokenSources, type Fetcher } from '@towncore/adapters';
import { loadEnv } from '@towncore/config';
import type { Db } from '@towncore/db';
import { advanceCohorts, cohortDepsFromEnv, runSourceDiscovery } from '@towncore/launcher';
import { alertRecipients, sendStaffEmail } from '@towncore/mail';
import {
  digestText,
  markDigestEmailed,
  runLearningLoops,
  storeDigest,
  type Llm,
} from '@towncore/pipeline';
import type { Logger } from 'pino';
import type { OpsDeps } from './mail';

// Agentic operations (owner, 2026-10-17; docs/plans/agentic-ops.md): the launch chain, source
// discovery, self-healing adapters, the daily digest and the learning loops. Each one prepares a
// decision for a person; none of them buys, sends to the public, deploys or approves Tier 3.

/** Launch cohorts, every 5 minutes, only where COHORT_ORCHESTRATOR=worker. */
export async function runCohorts(db: Db, fetcher: Fetcher, llm: Llm | undefined, logger: Logger) {
  if (loadEnv().COHORT_ORCHESTRATOR !== 'worker') return;
  const n = await advanceCohorts(
    cohortDepsFromEnv(db, {
      fetcher,
      ...(llm ? { llm } : {}),
      log: (message, data) => logger.info(data ?? {}, message),
    }),
  );
  if (n) logger.info({ cohorts: n }, 'launch cohorts advanced');
}

/** Weekly: new sources for the towns furthest below the Rule 7 target. */
export async function runDiscovery(db: Db, fetcher: Fetcher, llm: Llm | undefined, logger: Logger) {
  const results = await runSourceDiscovery({
    db,
    fetcher,
    ...(llm ? { llm } : {}),
    log: (message, data) => logger.info(data ?? {}, message),
  });
  for (const r of results) logger.info(r, 'source discovery');
}

/** Hourly: broken sources get a fixture, a diagnosis and a fix request. */
export async function runAdapterFixes(db: Db, fetcher: Fetcher, logger: Logger) {
  const run = await diagnoseBrokenSources(db, fetcher);
  if (run.checked) logger.info(run, 'adapter fix requests');
}

/**
 * The live eval reports, from the repo checkout the worker runs in: src/agents.ts and the bundled
 * dist/main.js sit at the same depth under apps/worker.
 */
export const VARIANTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/prompts/evals/variants',
);

/** Daily: proposals from experiments, routing evals and cohort gates. */
export async function runLearning(db: Db, logger: Logger) {
  const run = await runLearningLoops(db, { variantsDir: VARIANTS_DIR });
  if (run.opened || run.refreshed) logger.info(run, 'learning proposals');
}

/**
 * Daily, before the US Eastern morning: the digest, stored for Admin → Digest and emailed to
 * active admins on the company domain only (sendStaffEmail refuses anyone else). Logged, not
 * sent, with MAIL_TRANSPORT=log; kept unsent while mail isn't configured.
 */
export async function runDigest(
  db: Db,
  mail: OpsDeps['alertMail'],
  logger: Logger,
  now = new Date(),
) {
  const { digest, created } = await storeDigest(db, now);
  if (created) logger.info({ date: digest.date }, 'daily digest built');
  if (digest.emailedAt || !mail) return;
  const to = await alertRecipients(db);
  if (!to.length) return;
  const items = digest.items as Parameters<typeof digestText>[1];
  await sendStaffEmail(mail.transport, mail.configurationSet, {
    to,
    subject: `TownCore daily digest, ${digest.date}`,
    text: digestText(digest.date, items, loadEnv().APP_BASE_URL ?? ''),
  });
  await markDigestEmailed(db, digest.id, now);
  logger.info({ date: digest.date, to: to.length }, 'daily digest emailed');
}
