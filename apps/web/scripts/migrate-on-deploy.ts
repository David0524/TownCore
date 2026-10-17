// Runs before `next build` on Vercel (`vercel-build`; owner, 2026-10-17: "migrate on Vercel
// build"). A production deploy applies the repo's new migrations first, so the code that goes
// live never reads a table its database doesn't have yet; a failed migration fails the build and
// the previous deploy stays live. Previews share the production database, so they never migrate:
// a pull request's migration runs only once it is merged and deployed.
import { loadEnv } from '@towncore/config';
import { runMigrations } from '@towncore/db/migrate';

const env = loadEnv();

if (env.VERCEL_ENV !== 'production') {
  console.log(`Migrations skipped (VERCEL_ENV=${env.VERCEL_ENV ?? 'unset'}).`);
} else {
  // Migrations take the direct connection where the host offers one (Neon's unpooled URL).
  const url = env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL;
  if (!url) throw new Error('No DATABASE_URL_UNPOOLED or DATABASE_URL to migrate.');
  await runMigrations(url);
  console.log('Migrations applied.');
}
