import { loadEnv } from '@towncore/config';
import { eq, isNotNull, mailDomains, or, type Db } from '@towncore/db';
import {
  checkVerification,
  pgOnboardingStore,
  sesIdentities,
  type IdentityProvider,
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
