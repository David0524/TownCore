// pnpm --filter @towncore/adapters beach:record <fixture-name> <zone> <surf office> <tide station> <uv zip>
// Records the beach tiles' requests (NWS SRF, NOAA CO-OPS, EPA UV) as a fixture (CLAUDE.md §9).
// In the cloud sandbox run with NODE_USE_ENV_PROXY=1.
import { fileURLToPath } from 'node:url';
import { defaultFetch, Fetcher } from '../http/fetcher';
import { recordingFetch } from '../http/fixtures';
import { fetchBeach } from '../nws/beach';

const [name, zone, surfOffice, tideStation, uvZip] = process.argv.slice(2);
if (!name || !zone || !surfOffice || !tideStation || !uvZip) {
  throw new Error('usage: beach:record <name> <zone> <surf office> <tide station> <uv zip>');
}
const recorder = recordingFetch(defaultFetch);
const now = new Date();
const beach = await fetchBeach(
  new Fetcher({ fetchImpl: recorder.fetch }),
  { zone, surfOffice, tideStation, uvZip, timezone: 'America/New_York' },
  now,
);
const out = fileURLToPath(new URL(`../../fixtures/nws/${name}.json`, import.meta.url));
recorder.save(out);
console.log(`Recorded beach conditions at ${now.toISOString()} to ${out}`, beach);
