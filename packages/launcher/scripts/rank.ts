// pnpm towns:rank FL [--near "Boca Raton, FL"] [--radius 60] [--top 25]
// Ranks a state's incorporated places from Census files (CLAUDE.md §10a), saves them as
// town_candidates for an admin to approve, and writes docs/town-rankings/<state>-<date>.{csv,md}.
import { fileURLToPath } from 'node:url';
import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb } from '@towncore/db';
import {
  findPlace,
  loadRankFacts,
  rankingCsv,
  rankingReport,
  rankPlaces,
  saveCandidates,
  writeRanking,
} from '../src';

loadDotEnv();
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const state = args.find((a) => /^[A-Za-z]{2}$/.test(a))?.toUpperCase();
if (!state) {
  console.error('Usage: pnpm towns:rank <STATE> [--near "Town, ST"] [--radius 60] [--top 25]');
  process.exit(1);
}
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
try {
  console.log(`Loading Census files for ${state} (downloaded once, then cached)…`);
  const facts = await loadRankFacts(db, state);
  const nearName = flag('near');
  const radiusMiles = Number(flag('radius') ?? 60);
  const near = nearName ? findPlace(facts.places, nearName) : undefined;
  const rows = rankPlaces(facts, near ? { near, radiusMiles } : {});
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const md = rankingReport({
    state,
    rows,
    date,
    existing: facts.existing,
    top: Number(flag('top') ?? 25),
    ...(near ? { near: { name: `${near.name}, ${state}`, radiusMiles } } : {}),
  });
  const dir = fileURLToPath(new URL('../../../docs/town-rankings', import.meta.url));
  const files = writeRanking(dir, state, date, rankingCsv(rows), md);
  const { saved } = await saveCandidates(db, state, rows, now);
  console.log(`Ranked ${rows.length} places; saved ${saved} candidates.`);
  for (const r of rows.slice(0, 10))
    console.log(`${String(r.rank).padStart(3)}  ${r.score.toFixed(3)}  ${r.name}`);
  console.log(`Report: ${files.md}\nCSV:    ${files.csv}`);
  console.log('Approve towns in Admin → Launches before launching any of them.');
} finally {
  await db.$client.end();
}
