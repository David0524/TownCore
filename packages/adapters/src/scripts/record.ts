// In a proxied environment (like the Claude Code cloud sandbox) run with NODE_USE_ENV_PROXY=1 so
// Node's fetch uses HTTPS_PROXY. Not needed in production.
// pnpm --filter @towncore/adapters fixtures:record <platform> <fixture-name> '<source config JSON>'
// Runs an adapter against the live source through the polite Fetcher and saves every HTTP
// exchange as a fixture for offline tests (CLAUDE.md §9).
import { fileURLToPath } from 'node:url';
import '../adapters';
import { defaultFetch, Fetcher } from '../http/fetcher';
import { recordingFetch } from '../http/fixtures';
import { getAdapter } from '../registry';

const [platform, name, configJson = '{}'] = process.argv.slice(2);
if (!platform || !name)
  throw new Error('usage: fixtures:record <platform> <fixture-name> [source config JSON]');
const adapter = getAdapter(platform);
if (!adapter) throw new Error(`No adapter for platform ${platform}`);

const parsed = JSON.parse(configJson) as {
  url?: string;
  kind?: string;
  config?: Record<string, unknown>;
};
// The recorder wraps the real fetch, and the Fetcher still enforces Rule 8 on every request.
const recorder = recordingFetch(defaultFetch);
const fetcher = new Fetcher({ fetchImpl: recorder.fetch });
const records = await adapter.fetch(
  {
    id: 'fixture',
    townId: 'fixture',
    kind: (parsed.kind ?? adapter.kinds[0]) as never,
    platform,
    url: parsed.url ?? null,
    config: parsed.config ?? {},
  },
  null,
  { fetcher, now: new Date() },
);
const out = fileURLToPath(new URL(`../../fixtures/${platform}/${name}.json`, import.meta.url));
recorder.save(out);
console.log(`Recorded ${records.length} record(s) to ${out}`);
