import type { Fetcher } from '@towncore/adapters';
import { loadEnv } from '@towncore/config';
import { and, eq, ne, sources, towns, type Db } from '@towncore/db';
import {
  DBPR,
  draftFollowups,
  geocodeListings,
  runMonthlyPricing,
  seedDirectory,
  sendApprovedFollowups,
  sendMonthlyReports,
} from '@towncore/directory';
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
  const { sent } = await sendMonthlyReports({ db, ...mail, ...ownerMailEnv() });
  if (sent) logger.info({ sent }, 'proof reports sent');
}

/**
 * Directory prices (owner, 2026-10-17): once per town and local month, each category product's
 * price is recalculated from aggregate signals inside the guardrails; bigger increases wait as
 * proposals in Admin → Directory → Pricing. Existing subscriptions are never changed.
 */
export async function recalculatePrices(db: Db, logger: Logger, now = new Date()) {
  const result = await runMonthlyPricing(db, now);
  if (result.towns) logger.info(result, 'directory prices recalculated');
}

/** Unsubscribe links and the postal footer for mail to owners. */
const ownerMailEnv = () => ({
  tokenSecret: loadEnv().MAIL_TOKEN_SECRET,
  postalAddress: loadEnv().MAIL_POSTAL_ADDRESS ?? null,
});

/**
 * Owner follow-ups (owner, 2026-10-17): drafts for every town that isn't paused, then the
 * automatic sender, which mails only in towns with the standing approval on (Rule 10).
 */
export async function runFollowups(
  db: Db,
  mail: OpsDeps['alertMail'],
  logger: Logger,
  now = new Date(),
) {
  const active = await db.select({ id: towns.id }).from(towns).where(ne(towns.status, 'paused'));
  for (const town of active) {
    try {
      const { created } = await draftFollowups(db, town.id, now);
      if (created) logger.info({ townId: town.id, created }, 'owner follow-ups drafted');
    } catch (error) {
      logger.error({ townId: town.id, err: error }, 'owner follow-ups failed');
    }
  }
  if (!mail) return;
  const result = await sendApprovedFollowups({ db, ...mail, ...ownerMailEnv() }, now);
  if (result.sent || result.skipped) logger.info(result, 'owner follow-ups sent');
}
