import { GetAccountCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { eq, mailSettings, type Db } from '@towncore/db';
import { withRetry } from '../retry';

// The SES account's own standing (brief §7.2). SES sends no event for an account-level pause,
// so the worker reads GetAccount every few minutes and keeps the answer for the health page.

export type SesAccountStatus = {
  /** HEALTHY | PROBATION | SHUTDOWN (SES API reference, GetAccount). */
  enforcementStatus: string;
  productionAccess: boolean;
  sendingEnabled: boolean;
  max24HourSend: number | null;
  sentLast24Hours: number | null;
  maxSendRate: number | null;
  checkedAt: string;
};

export interface AccountReader {
  getAccount(): Promise<Omit<SesAccountStatus, 'checkedAt'>>;
}

export function sesAccount(options: { region: string; client?: SESv2Client }): AccountReader {
  const client = options.client ?? new SESv2Client({ region: options.region, maxAttempts: 3 });
  return {
    async getAccount() {
      const r = await withRetry(() => client.send(new GetAccountCommand({})));
      return {
        enforcementStatus: r.EnforcementStatus ?? 'UNKNOWN',
        productionAccess: r.ProductionAccessEnabled ?? false,
        sendingEnabled: r.SendingEnabled ?? false,
        max24HourSend: r.SendQuota?.Max24HourSend ?? null,
        sentLast24Hours: r.SendQuota?.SentLast24Hours ?? null,
        maxSendRate: r.SendQuota?.MaxSendRate ?? null,
      };
    },
  };
}

const KEY = 'ses_account';

export async function refreshAccountStatus(db: Db, reader: AccountReader, now = new Date()) {
  const status: SesAccountStatus = { ...(await reader.getAccount()), checkedAt: now.toISOString() };
  await db
    .insert(mailSettings)
    .values({ key: KEY, value: status })
    .onConflictDoUpdate({ target: mailSettings.key, set: { value: status } });
  return status;
}

export async function storedAccountStatus(db: Db): Promise<SesAccountStatus | null> {
  const [row] = await db.select().from(mailSettings).where(eq(mailSettings.key, KEY));
  return (row?.value as SesAccountStatus | undefined) ?? null;
}
