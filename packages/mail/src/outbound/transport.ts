import { randomUUID } from 'node:crypto';
import { SendEmailCommand, SESv2Client, TooManyRequestsException } from '@aws-sdk/client-sesv2';
import { RetryableError, withRetry, type RetryOptions } from '../retry';

// How a built message leaves (brief §3: SES v2). The log transport writes it to the server log
// instead, for development and CI; it never reaches a real person (Rule 10).

export type SendRequest = {
  raw: Buffer;
  from: string;
  to: string[];
  cc: string[];
  configurationSet: string;
  tags: Record<string, string>;
};

export interface MailTransport {
  readonly name: 'ses' | 'log';
  send(request: SendRequest): Promise<{ sesMessageId: string }>;
}

/** SES tag values allow letters, digits, _ and - only. */
export function tagValue(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256);
}

export function sesTransport(options: {
  region: string;
  client?: SESv2Client;
  retry?: RetryOptions;
}): MailTransport {
  const client = options.client ?? new SESv2Client({ region: options.region, maxAttempts: 3 });
  return {
    name: 'ses',
    async send(request) {
      const result = await withRetry(async () => {
        try {
          return await client.send(
            new SendEmailCommand({
              FromEmailAddress: request.from,
              Destination: {
                ToAddresses: request.to,
                CcAddresses: request.cc.length ? request.cc : undefined,
              },
              Content: { Raw: { Data: request.raw } },
              ConfigurationSetName: request.configurationSet,
              EmailTags: Object.entries(request.tags).map(([Name, Value]) => ({
                Name,
                Value: tagValue(Value),
              })),
            }),
          );
        } catch (error) {
          if (error instanceof TooManyRequestsException) throw new RetryableError(error.message);
          throw error;
        }
      }, options.retry);
      if (!result.MessageId) throw new Error('SES accepted the message but returned no MessageId');
      return { sesMessageId: result.MessageId };
    },
  };
}

export function logTransport(log: (line: string) => void = console.info): MailTransport {
  return {
    name: 'log',
    async send(request) {
      const id = `log-${randomUUID()}`;
      log(
        `[mail:log] ${id} from=${request.from} to=${request.to.join(',')} cc=${request.cc.join(',')} ` +
          `set=${request.configurationSet} tags=${JSON.stringify(request.tags)} bytes=${request.raw.length}`,
      );
      return { sesMessageId: id };
    },
  };
}
