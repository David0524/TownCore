import { loadEnv } from '@towncore/config';
import { eq, isNotNull, loadRoutingTable, mailDomains, or, type Db } from '@towncore/db';
import {
  checkVerification,
  pgOnboardingStore,
  processDueEvents,
  processReceivedNotification,
  s3MailStore,
  sesIdentities,
  type EventHandler,
  type IdentityProvider,
  type MailObjectStore,
} from '@towncore/mail';
import type { Logger } from 'pino';

// Every few minutes: finish domains waiting on SES verification, and answer "Re-check" clicks
// from /admin/mail/domains. Reads SES only; DNS and identities are the onboarding CLI's job.

export function sesFromEnv(): IdentityProvider | null {
  const env = loadEnv();
  if (!env.AWS_ACCESS_KEY_ID) return null;
  return sesIdentities({ region: env.AWS_REGION ?? 'us-east-1' });
}

export async function runMailTick(
  db: Db,
  ses: IdentityProvider | null,
  logger: Logger,
): Promise<void> {
  const due = await db
    .select({ id: mailDomains.id, name: mailDomains.name })
    .from(mailDomains)
    .where(or(eq(mailDomains.status, 'onboarding'), isNotNull(mailDomains.recheckRequestedAt)));
  if (!due.length) return;
  if (!ses) {
    logger.warn({ domains: due.length }, 'mail tick: no AWS credentials, skipping SES checks');
    return;
  }
  const store = pgOnboardingStore(db);
  for (const domain of due) {
    try {
      const result = await checkVerification(domain.name, { store, ses });
      logger.info({ domain: domain.name, ...result }, 'mail domain checked');
      if (result.outcome !== 'skipped' || result.detail !== 'an onboarding run holds it') {
        await db
          .update(mailDomains)
          .set({ recheckRequestedAt: null })
          .where(eq(mailDomains.id, domain.id));
      }
    } catch (error) {
      logger.error({ err: error, domain: domain.name }, 'mail domain check failed');
    }
  }
}

export type InboundConfig = { objects: MailObjectStore; bucket: string };

export function inboundFromEnv(): InboundConfig | null {
  const env = loadEnv();
  if (!env.AWS_ACCESS_KEY_ID || !env.MAIL_S3_BUCKET) return null;
  return {
    bucket: env.MAIL_S3_BUCKET,
    objects: s3MailStore({ region: env.AWS_REGION ?? 'us-east-1', bucket: env.MAIL_S3_BUCKET }),
  };
}

/** Handles one stored SNS notification. Sending events (bounces, deliveries) arrive in Mail-4. */
export function mailEventHandler(db: Db, inbound: InboundConfig, logger: Logger): EventHandler {
  return async (event) => {
    if (event.type !== 'Received')
      return { status: 'dropped', note: `${event.type} is not handled yet` };
    const result = await processReceivedNotification(event.payload, {
      db,
      objects: inbound.objects,
      bucket: inbound.bucket,
      routing: await loadRoutingTable(db),
    });
    logger.info({ event: event.id, ...result }, 'inbound mail processed');
    return result.outcome === 'stored'
      ? { status: 'done' }
      : {
          status: 'dropped',
          note: result.dropped.map((d) => `${d.recipient}: ${d.reason}`).join('; '),
        };
  };
}

/**
 * Polls mail_events every few seconds. Returns a stop function that waits for the batch in
 * flight. Does nothing without AWS credentials and a mail bucket.
 */
export function startInboundLoop(
  db: Db,
  inbound: InboundConfig | null,
  logger: Logger,
  intervalMs = 5_000,
): () => Promise<void> {
  if (!inbound) {
    logger.info('inbound mail: no AWS credentials or MAIL_S3_BUCKET, not polling');
    return async () => {};
  }
  const handler = mailEventHandler(db, inbound, logger);
  let running: Promise<unknown> = Promise.resolve();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = () => {
    if (stopped) return;
    running = processDueEvents(db, handler)
      .then((r) => {
        if (r.retried || r.failed) logger.warn(r, 'mail events retried or failed');
      })
      .catch((error: unknown) => logger.error({ err: error }, 'mail event batch failed'))
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, intervalMs);
      });
  };
  timer = setTimeout(tick, 0);
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}
