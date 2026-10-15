import { loadDotEnv, requireEnv } from '@towncore/config';
import { runMigrations } from '../migrate.js';

loadDotEnv();
await runMigrations(requireEnv('DATABASE_URL'));
console.log('Migrations applied.');
