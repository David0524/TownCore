// Eval runner (CLAUDE.md §12; docs/plans/M3.md §11).
//   pnpm evals          replays recorded model responses (offline; CI). No recording: skips.
//   pnpm evals --live   calls the configured model provider and records its responses.
// Runs against a throwaway test database; never touches the dev or production data.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { civicplusAdapter, Fetcher, replayFetch, type SourceConfig } from '@towncore/adapters';
import { loadTowns } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { getTownBySlug, syncTowns } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { evalRegressions, loadEvalCases, runEvals, type EvalSummary } from '../src/evals';
import { providerFromEnv, recordingProvider, replayProvider, type Llm } from '../src/llm';

loadDotEnv();
const live = process.argv.includes('--live');
// A live run that's worse than the committed baseline is saved only with a stated reason (D-M8-5).
const acceptAt = process.argv.indexOf('--accept-regression');
const acceptReason = acceptAt >= 0 ? process.argv[acceptAt + 1]?.trim() : undefined;
if (acceptAt >= 0 && !acceptReason) {
  console.error('--accept-regression needs a reason: --accept-regression "why this is acceptable"');
  process.exit(1);
}
const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const evalsDir = root('packages/prompts/evals');
const recordedDir = `${evalsDir}/recorded`;
// A fixed clock, so prompts (which include dates) are identical run to run.
const NOW = new Date('2026-10-15T16:00:00Z');

// Real cases take their text from the adapters' recorded fixtures, parsed by the adapter itself.
const newsflash: SourceConfig = {
  id: 'eval',
  townId: 'eval',
  kind: 'city_news',
  platform: 'civicplus',
  url: 'https://www.myboca.us/',
  config: { module: 'newsflash', catId: 'All-newsflash.xml', timezone: 'America/New_York' },
};
const fetcher = new Fetcher({
  fetchImpl: replayFetch(root('packages/adapters/fixtures/civicplus/boca-newsflash.json')),
  sleep: async () => {},
  now: () => 0,
  minIntervalMs: 0,
});
const releases = await civicplusAdapter.fetch(newsflash, null, { fetcher, now: NOW });
const fixtureText = (_fixture: string, id: string) => {
  const r = releases.find((x) => x.externalId === `news:${id}`);
  if (!r) throw new Error(`No release ${id} in the fixture`);
  return { title: r.title ?? '', text: r.text ?? '' };
};

const cases = loadEvalCases(`${evalsDir}/cases.json`, fixtureText);

let llm: Llm;
let save: ((path: string) => void) | undefined;
const { db, drop } = await createTestDb();
try {
  if (live) {
    const { name, provider } = providerFromEnv();
    const recorder = recordingProvider(provider);
    llm = { db, provider: recorder.provider, providerName: name, now: () => NOW };
    save = (path) => recorder.save(path);
    console.log(`Live eval with ${name}.`);
  } else {
    const files = existsSync(recordedDir)
      ? readdirSync(recordedDir)
          .filter((f) => f.endsWith('.json'))
          .sort(
            (a, b) =>
              statSync(`${recordedDir}/${b}`).mtimeMs - statSync(`${recordedDir}/${a}`).mtimeMs,
          )
      : [];
    if (files.length === 0) {
      console.log(
        'No recorded model responses yet; run `pnpm evals --live` with a model key. Skipping.',
      );
      process.exit(0);
    }
    const [file] = files;
    const providerName = file!.startsWith('anthropic') ? 'anthropic' : 'gemini';
    llm = { db, provider: replayProvider(`${recordedDir}/${file}`), providerName, now: () => NOW };
    console.log(`Replaying ${file}.`);
  }

  const loaded = loadTowns(root('towns')).filter((t) => t.config.slug === 'boca-raton');
  await syncTowns(
    db,
    loaded.map((t) => ({ ...t, config: { ...t.config, sources: [] } })),
  );
  const town = (await getTownBySlug(db, 'boca-raton'))!;
  const summary = await runEvals(db, town.id, cases, { llm, now: NOW });

  for (const r of summary.results) {
    const outcome = r.skip ? `skipped: ${r.skip}` : `${r.status}, Tier ${r.tier}`;
    const fc = r.factcheckScore === null ? '' : `, fact-check ${r.factcheckScore}`;
    console.log(`${r.failures.length ? '✗' : '✓'} ${r.id}: ${outcome}${fc}`);
    for (const f of r.failures) console.log(`    ${f}`);
  }
  console.log(
    `\n${summary.passed}/${summary.cases} cases pass · safety failures ${summary.safetyFailures} · ` +
      `fact-check pass rate ${(summary.factcheckPassRate * 100).toFixed(0)}% · ` +
      `verbatim quotes ${(summary.verbatimQuoteRate * 100).toFixed(0)}%`,
  );

  const baselinePath = `${evalsDir}/last-report.json`;
  const baseline = existsSync(baselinePath)
    ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as EvalSummary)
    : null;
  const regressions = baseline ? evalRegressions(baseline, summary) : [];
  for (const r of regressions) console.log(`REGRESSION: ${r}`);
  if (live && save) {
    if (regressions.length && !acceptReason) {
      console.error(
        '\nNot saved: this run is worse than the committed baseline (CLAUDE.md §12). Fix the prompt, or re-run with --accept-regression "<reason>".',
      );
      process.exitCode = 1;
    } else {
      mkdirSync(recordedDir, { recursive: true });
      save(`${recordedDir}/${llm.providerName}.json`);
      const report = acceptReason
        ? { ...summary, acceptedRegression: { reason: acceptReason, regressions } }
        : summary;
      writeFileSync(baselinePath, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`Recorded responses to prompts/evals/recorded/${llm.providerName}.json`);
    }
  }
  // A replay must match its baseline exactly: a drift means the recording and report disagree.
  if (!live && regressions.length) process.exitCode = 1;
  // Safety failures always fail. Replays are deterministic, so any failure fails too.
  if (summary.safetyFailures > 0 || (!live && summary.passed < summary.cases)) process.exitCode = 1;
} finally {
  await drop();
}
