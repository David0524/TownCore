// Eval runner (CLAUDE.md §12; docs/plans/M3.md §11).
//   pnpm evals          replays recorded model responses (offline; CI). No recording: skips.
//   pnpm evals --live   calls the configured model provider and records its responses.
// Runs against a throwaway test database; never touches the dev or production data.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  civicplusAdapter,
  Fetcher,
  legistarAdapter,
  replayFetch,
  type RawRecord,
  type SourceConfig,
} from '@towncore/adapters';
import { defaultTheme, loadTowns, parseTownConfig } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { getTownBySlug, syncTowns } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { aiUsage, sql } from '@towncore/db';
import {
  EVAL_VARIANTS,
  evalRegressions,
  loadEvalCases,
  runEvals,
  type EvalSummary,
  type VariantReport,
} from '../src/evals';
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
// A route variant to compare (EVAL_VARIANTS); anything but the baseline runs live only.
const variantAt = process.argv.indexOf('--variant');
const variant = variantAt >= 0 ? process.argv[variantAt + 1] : 'baseline';
if (!variant || !EVAL_VARIANTS[variant]) {
  console.error(`--variant must be one of: ${Object.keys(EVAL_VARIANTS).join(', ')}`);
  process.exit(1);
}
if (variant !== 'baseline' && !live) {
  console.error('Route variants call the model: run them with --live.');
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
// Delray Beach's Legistar meetings (a launch dry-run town).
const delrayMeetings: SourceConfig = {
  id: 'eval',
  townId: 'eval',
  kind: 'agenda',
  platform: 'legistar',
  url: 'https://delraybeach.legistar.com/',
  config: { timezone: 'America/New_York', pastDays: 14, aheadDays: 14 },
};
const replayed = (fixture: string) =>
  new Fetcher({
    fetchImpl: replayFetch(root(`packages/adapters/fixtures/${fixture}.json`)),
    sleep: async () => {},
    now: () => 0,
    minIntervalMs: 0,
  });
const fixtures: Record<string, { records: RawRecord[]; id: (id: string) => string }> = {
  'civicplus/boca-newsflash': {
    records: await civicplusAdapter.fetch(newsflash, null, {
      fetcher: replayed('civicplus/boca-newsflash'),
      now: NOW,
    }),
    id: (id) => `news:${id}`,
  },
  'legistar/delray-events': {
    records: await legistarAdapter.fetch(delrayMeetings, null, {
      fetcher: replayed('legistar/delray-events'),
      now: new Date('2026-10-16T12:00:00Z'),
    }),
    id: (id) => id,
  },
};
const fixtureText = (fixture: string, id: string) => {
  const source = fixtures[fixture];
  if (!source) throw new Error(`No eval loader for fixture ${fixture}`);
  const r = source.records.find((x) => x.externalId === source.id(id));
  if (!r) throw new Error(`No record ${id} in ${fixture}`);
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
    llm = {
      db,
      provider: recorder.provider,
      providerName: name,
      now: () => NOW,
      routeOverrides: EVAL_VARIANTS[variant],
    };
    save = (path) => recorder.save(path);
    console.log(`Live eval with ${name}, routing variant ${variant}.`);
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

  // Boca, the two fictional design towns and Delray's launch dry run: cases from each.
  const evalTowns = [
    ...loadTowns(root('towns')).filter((t) => t.config.slug === 'boca-raton'),
    ...loadTowns(root('apps/web/e2e/fixtures/towns')).filter((t) =>
      ['harbor-point', 'pine-hollow'].includes(t.config.slug),
    ),
    // A launch's town file waits outside towns/ until the owner approves it (D-M7-9).
    {
      config: parseTownConfig(
        readFileSync(root('docs/launches/delray-beach/town/delray-beach.yaml'), 'utf8'),
        'delray-beach.yaml',
      ),
      theme: defaultTheme,
      hasThemeFile: false,
    },
  ];
  await syncTowns(
    db,
    evalTowns.map((t) => ({ ...t, config: { ...t.config, sources: [], guides: [] } })),
  );
  const ids: Record<string, string> = {};
  for (const t of evalTowns) ids[t.config.slug] = (await getTownBySlug(db, t.config.slug))!.id;
  const summary = await runEvals(db, ids, cases, { llm, now: NOW });

  for (const r of summary.results) {
    if (r.notRecorded) {
      console.log(`· ${r.id}: not recorded yet (run pnpm evals --live)`);
      continue;
    }
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

  if (summary.notRecorded)
    console.log(`${summary.notRecorded} cases have no recorded answers yet and were left out.`);

  // Every live run is kept as a variant report, with its cost, for pnpm evals:compare.
  if (live) {
    const [spent] = await db
      .select({
        usd: sql<string>`coalesce(sum(${aiUsage.estCostUsd}), 0)`,
        calls: sql<number>`count(*)::int`,
      })
      .from(aiUsage);
    const report: VariantReport = {
      variant,
      provider: llm.providerName,
      ranAt: new Date().toISOString(),
      summary,
      costUsd: Number(spent?.usd ?? 0),
      calls: spent?.calls ?? 0,
    };
    mkdirSync(`${evalsDir}/variants`, { recursive: true });
    writeFileSync(
      `${evalsDir}/variants/${llm.providerName}-${variant}.json`,
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(`Variant report: prompts/evals/variants/${llm.providerName}-${variant}.json`);
    // Only the baseline routing records responses and moves the committed baseline.
    if (variant !== 'baseline') save = undefined;
  }

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
