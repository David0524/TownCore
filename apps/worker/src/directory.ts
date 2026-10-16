import type { Fetcher } from '@towncore/adapters';
import { and, eq, ne, sources, towns, type Db } from '@towncore/db';
import { DBPR, geocodeListings, seedDirectory, sendMonthlyReports } from '@towncore/directory';
import type { OpsDeps } from './mail';
import type { Logger } from 'pino';

// The business directory (M6): seed listings from state license records once a day (the DBPR
// files change weekly), and geocode a few hundred pending listings every 15 minutes.

async function directoryTowns(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ townId: sources.townId })
    .from(sources)
    .innerJoin(towns, eq(sources.townId, towns.id))
    .where(and(eq(sources.platform, DBPR), ne(towns.status, 'paused')));
  return rows.map((r) => r.townId);
}

export async function refreshDirectory(db: Db, logger: Logger, now = new Date()) {
  for (const townId of await directoryTowns(db)) {
    try {
      logger.info({ townId, ...(await seedDirectory(db, townId, now)) }, 'directory seeded');
    } catch (error) {
      logger.error({ townId, err: error }, 'directory seeding failed');
    }
  }
}

export async function geocodeDirectory(db: Db, fetcher: Fetcher, logger: Logger) {
  for (const townId of await directoryTowns(db)) {
    const result = await geocodeListings(db, fetcher, townId, { limit: 200 });
    if (result.matched || result.noMatch || result.failed)
      logger[result.failed ? 'warn' : 'info']({ townId, ...result }, 'directory geocoding');
  }
}

/**
 * Last month's proof reports (D-M6-10), on the 1st to 3rd of the month in each town's time.
 * Account mail through the conversational stream; skipped while sending isn't set up.
 */
export async function sendProofReports(db: Db, mail: OpsDeps['alertMail'], logger: Logger) {
  if (!mail) return;
  const { sent } = await sendMonthlyReports({ db, ...mail });
  if (sent) logger.info({ sent }, 'proof reports sent');
}
