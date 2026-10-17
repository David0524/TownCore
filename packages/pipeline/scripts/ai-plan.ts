// pnpm ai:plan <town-slug> [--provider anthropic|gemini]: what one day of the town's work would
// ask of the models, from its last week of records, with no API key and no model call (owner,
// 2026-10-17, model protocol §5).
import { llmProviders, requireEnv, type LlmProviderName } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb } from '@towncore/db';
import { formatPlan, planDay } from '../src/ai-plan';

loadDotEnv();
const slug = process.argv[2];
const at = process.argv.indexOf('--provider');
const provider = (at >= 0 ? process.argv[at + 1] : 'anthropic') as LlmProviderName;
if (!slug || slug.startsWith('--') || !llmProviders.includes(provider)) {
  console.error('usage: pnpm ai:plan <town-slug> [--provider anthropic|gemini]');
  process.exit(1);
}
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
try {
  console.log(formatPlan(await planDay(db, slug, { provider })));
} finally {
  await db.$client.end();
}
