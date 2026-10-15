import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { runMigrations } from '../migrate';

loadDotEnv();
await runMigrations(requireEnv('DATABASE_URL'));
console.log('Migrations applied.');
