// pnpm --filter @towncore/adapters weather:record <fixture-name> <lat,lon> <zone>
// Records the Today tile's NWS requests as a fixture (CLAUDE.md §9). In the cloud sandbox run
// with NODE_USE_ENV_PROXY=1.
import { fileURLToPath } from 'node:url';
import { defaultFetch, Fetcher } from '../http/fetcher';
import { recordingFetch } from '../http/fixtures';
import { fetchWeather } from '../nws/weather';

const [name, point, zone] = process.argv.slice(2);
if (!name || !point || !zone) throw new Error('usage: weather:record <name> <lat,lon> <zone>');
const recorder = recordingFetch(defaultFetch);
const snapshot = await fetchWeather(new Fetcher({ fetchImpl: recorder.fetch }), { point, zone });
const out = fileURLToPath(new URL(`../../fixtures/nws/${name}.json`, import.meta.url));
recorder.save(out);
console.log(`Recorded weather for ${snapshot.place} (${snapshot.alerts.length} alerts) to ${out}`);
