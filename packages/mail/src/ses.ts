import {
  AlreadyExistsException,
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  GetEmailIdentityCommand,
  NotFoundException,
  PutEmailIdentityMailFromAttributesCommand,
  SESv2Client,
  TooManyRequestsException,
} from '@aws-sdk/client-sesv2';
import { RetryableError, withRetry, type RetryOptions } from './retry';

// SES v2 identity calls for onboarding. Each domain gets two identities (root and news.), each
// with Easy DKIM (its own keys) and a custom MAIL FROM (brief §3 items 8–9).

export type IdentityInfo = {
  name: string;
  verificationStatus: string;
  dkimStatus: string;
  dkimTokens: string[];
  signingHostedZone: string;
  mailFromDomain: string | null;
  mailFromStatus: string | null;
  configurationSetName: string | null;
};

export interface IdentityProvider {
  getIdentity(name: string): Promise<IdentityInfo | null>;
  /** Creates the identity (Easy DKIM) with a default configuration set. Idempotent. */
  createIdentity(
    name: string,
    configurationSetName: string,
    tags: Record<string, string>,
  ): Promise<IdentityInfo>;
  setMailFrom(name: string, mailFromDomain: string): Promise<void>;
  /** Removes the identity (domain removal, Mail-6). Already gone is fine. */
  deleteIdentity(name: string): Promise<void>;
}

export function sesIdentities(options: {
  region: string;
  client?: SESv2Client;
  retry?: RetryOptions;
}): IdentityProvider {
  const client =
    options.client ??
    new SESv2Client({ region: options.region, maxAttempts: 5, retryMode: 'adaptive' });
  const send = <T>(fn: () => Promise<T>) =>
    withRetry(async () => {
      try {
        return await fn();
      } catch (error) {
        if (error instanceof TooManyRequestsException) throw new RetryableError(error.message);
        throw error;
      }
    }, options.retry);

  async function getIdentity(name: string): Promise<IdentityInfo | null> {
    try {
      const r = await send(() => client.send(new GetEmailIdentityCommand({ EmailIdentity: name })));
      return {
        name,
        verificationStatus: r.VerificationStatus ?? 'NOT_STARTED',
        dkimStatus: r.DkimAttributes?.Status ?? 'NOT_STARTED',
        dkimTokens: r.DkimAttributes?.Tokens ?? [],
        signingHostedZone: r.DkimAttributes?.SigningHostedZone ?? '',
        mailFromDomain: r.MailFromAttributes?.MailFromDomain ?? null,
        mailFromStatus: r.MailFromAttributes?.MailFromDomainStatus ?? null,
        configurationSetName: r.ConfigurationSetName ?? null,
      };
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
  }

  return {
    getIdentity,
    async createIdentity(name, configurationSetName, tags) {
      try {
        await send(() =>
          client.send(
            new CreateEmailIdentityCommand({
              EmailIdentity: name,
              ConfigurationSetName: configurationSetName,
              Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
            }),
          ),
        );
      } catch (error) {
        // A retried run, or a crash after SES accepted the call: the identity is already there.
        if (!(error instanceof AlreadyExistsException)) throw error;
      }
      const info = await getIdentity(name);
      if (!info) throw new Error(`SES identity ${name} missing right after creation`);
      return info;
    },
    async setMailFrom(name, mailFromDomain) {
      await send(() =>
        client.send(
          new PutEmailIdentityMailFromAttributesCommand({
            EmailIdentity: name,
            MailFromDomain: mailFromDomain,
            // If the MAIL FROM MX ever breaks, fall back to amazonses.com rather than bounce.
            BehaviorOnMxFailure: 'USE_DEFAULT_VALUE',
          }),
        ),
      );
    },
    async deleteIdentity(name) {
      try {
        await send(() => client.send(new DeleteEmailIdentityCommand({ EmailIdentity: name })));
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    },
  };
}

/** Fully verified: domain, DKIM and custom MAIL FROM all succeeded. */
export function identityVerified(info: IdentityInfo): boolean {
  return (
    info.verificationStatus === 'SUCCESS' &&
    info.dkimStatus === 'SUCCESS' &&
    info.mailFromStatus === 'SUCCESS'
  );
}

/** SES gave up on DKIM or MAIL FROM (it stops retrying after 72 hours). */
export function identityFailed(info: IdentityInfo): boolean {
  return (
    info.dkimStatus === 'FAILED' ||
    info.mailFromStatus === 'FAILED' ||
    info.verificationStatus === 'FAILED'
  );
}
