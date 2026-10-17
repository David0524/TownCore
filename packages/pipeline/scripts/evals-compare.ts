// pnpm evals:compare: every live eval variant side by side (packages/prompts/evals/variants), so
// the routing is chosen by results, not guesses (owner, 2026-10-17, model protocol §5). Quality
// first (safety failures, fact-check pass rate, unsupported claims), then cost.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compareVariants, type VariantReport } from '../src/evals';

const dir = fileURLToPath(new URL('../../prompts/evals/variants', import.meta.url));
const reports = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as VariantReport)
  : [];
if (reports.length === 0) {
  console.log(
    'No variant reports yet. With a model key: pnpm evals --live --variant baseline, then classify-sonnet and writer-thinking.',
  );
} else {
  for (const line of compareVariants(reports)) console.log(line);
}
