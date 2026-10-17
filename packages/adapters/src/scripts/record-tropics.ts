// pnpm --filter @towncore/adapters tropics:record <fixture-name>
// Records the National Hurricane Center's two shared files (active storms, outlooks) as a
// fixture (CLAUDE.md §9). In the cloud sandbox run with NODE_USE_ENV_PROXY=1.
import { fileURLToPath } from 'node:url';
import { defaultFetch, Fetcher } from '../http/fetcher';
import { recordingFetch } from '../http/fixtures';
import { fetchTropics } from '../nhc';

const [name] = process.argv.slice(2);
if (!name) throw new Error('usage: tropics:record <name>');
const recorder = recordingFetch(defaultFetch);
const tropics = await fetchTropics(new Fetcher({ fetchImpl: recorder.fetch }));
const out = fileURLToPath(new URL(`../../fixtures/nhc/${name}.json`, import.meta.url));
recorder.save(out);
console.log(`Recorded the tropics at ${new Date().toISOString()} to ${out}`);
console.dir(tropics, { depth: 5 });
