// pnpm maps:once [town-slug] [--file <state>-latest.osm.pbf]: refresh base maps from Geofabrik
// now (all towns, or one), then draw maps for eligible stories. Same code as the worker's monthly
// and 30-minute jobs. With --file it reads a state extract you downloaded yourself (for example
// https://download.geofabrik.de/north-america/us/florida-latest.osm.pbf) instead of fetching it:
// download.geofabrik.de refuses connections from the Claude Code cloud sandbox.
import { Fetcher } from '@towncore/adapters';
import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb } from '@towncore/db';
import { pino } from 'pino';
import { drawMaps, refreshBasemaps } from './maps';

loadDotEnv();
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
const logger = pino({ level: 'info' });
try {
  const args = process.argv.slice(2);
  const fileAt = args.indexOf('--file');
  const file = fileAt >= 0 ? args[fileAt + 1] : undefined;
  if (fileAt >= 0 && !file) throw new Error('--file needs a path to a .osm.pbf extract');
  const slug = args.find((a, i) => !a.startsWith('--') && (fileAt < 0 || i !== fileAt + 1));
  console.log('base maps:', await refreshBasemaps(db, logger, { slug, file }));
  console.log('maps:', await drawMaps(db, new Fetcher(), logger));
} finally {
  await db.$client.end();
}
