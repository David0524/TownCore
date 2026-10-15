import {
  AlreadyExistsException,
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  NotFoundException,
  PutEmailIdentityMailFromAttributesCommand,
  TooManyRequestsException,
  type SESv2Client,
} from '@aws-sdk/client-sesv2';
import { describe, expect, it } from 'vitest';
import { identityFailed, identityVerified, sesIdentities } from '../src/ses';

// GetEmailIdentity response shaped from the SES v2 API reference (checked 2026-10-15).
const getResponse = {
  ConfigurationSetName: 'towncore-dev-conversational',
  DkimAttributes: {
    SigningEnabled: true,
    Status: 'PENDING',
    Tokens: ['t1', 't2', 't3'],
    SigningHostedZone: 'dkim.amazonses.com',
    SigningAttributesOrigin: 'AWS_SES',
  },
  IdentityType: 'DOMAIN',
  MailFromAttributes: {
    MailFromDomain: 'mail.testtown.com',
    MailFromDomainStatus: 'PENDING',
    BehaviorOnMxFailure: 'USE_DEFAULT_VALUE',
  },
  VerificationStatus: 'PENDING',
  VerifiedForSendingStatus: false,
};

const meta = { $metadata: {} };
function stub(handler: (command: unknown) => unknown) {
  const sent: unknown[] = [];
  const client = {
    send: async (command: unknown) => {
      sent.push(command);
      return handler(command);
    },
  } as unknown as SESv2Client;
  return { client, sent };
}

describe('sesIdentities', () => {
  it('maps GetEmailIdentity, and a missing identity to null', async () => {
    const { client } = stub((c) => {
      if ((c as GetEmailIdentityCommand).input.EmailIdentity === 'missing.com')
        throw new NotFoundException({ message: 'nope', ...meta });
      return getResponse;
    });
    const ses = sesIdentities({ region: 'us-east-1', client });
    expect(await ses.getIdentity('testtown.com')).toEqual({
      name: 'testtown.com',
      verificationStatus: 'PENDING',
      dkimStatus: 'PENDING',
      dkimTokens: ['t1', 't2', 't3'],
      signingHostedZone: 'dkim.amazonses.com',
      mailFromDomain: 'mail.testtown.com',
      mailFromStatus: 'PENDING',
      configurationSetName: 'towncore-dev-conversational',
    });
    expect(await ses.getIdentity('missing.com')).toBeNull();
  });

  it('creates with a default configuration set and tags, and tolerates an existing identity', async () => {
    const { client, sent } = stub((c) => {
      if (c instanceof CreateEmailIdentityCommand)
        throw new AlreadyExistsException({ message: 'exists', ...meta });
      return getResponse;
    });
    const info = await sesIdentities({ region: 'us-east-1', client }).createIdentity(
      'testtown.com',
      'towncore-dev-conversational',
      { domain: 'testtown.com', stream: 'conversational' },
    );
    expect(info.dkimTokens).toHaveLength(3);
    expect((sent[0] as CreateEmailIdentityCommand).input).toEqual({
      EmailIdentity: 'testtown.com',
      ConfigurationSetName: 'towncore-dev-conversational',
      Tags: [
        { Key: 'domain', Value: 'testtown.com' },
        { Key: 'stream', Value: 'conversational' },
      ],
    });
  });

  it('sets MAIL FROM with fallback to the SES default on MX failure', async () => {
    const { client, sent } = stub(() => ({}));
    await sesIdentities({ region: 'us-east-1', client }).setMailFrom(
      'testtown.com',
      'mail.testtown.com',
    );
    expect(sent[0]).toBeInstanceOf(PutEmailIdentityMailFromAttributesCommand);
    expect((sent[0] as PutEmailIdentityMailFromAttributesCommand).input).toEqual({
      EmailIdentity: 'testtown.com',
      MailFromDomain: 'mail.testtown.com',
      BehaviorOnMxFailure: 'USE_DEFAULT_VALUE',
    });
  });

  it('retries throttling', async () => {
    let calls = 0;
    const { client } = stub(() => {
      if (++calls < 3) throw new TooManyRequestsException({ message: 'slow down', ...meta });
      return getResponse;
    });
    const ses = sesIdentities({ region: 'us-east-1', client, retry: { sleep: async () => {} } });
    expect(await ses.getIdentity('testtown.com')).not.toBeNull();
    expect(calls).toBe(3);
  });
});

describe('verification status', () => {
  const info = {
    name: 'x.com',
    verificationStatus: 'SUCCESS',
    dkimStatus: 'SUCCESS',
    dkimTokens: [],
    signingHostedZone: '',
    mailFromDomain: 'mail.x.com',
    mailFromStatus: 'SUCCESS',
    configurationSetName: null,
  };
  it('needs domain, DKIM and MAIL FROM all to succeed', () => {
    expect(identityVerified(info)).toBe(true);
    expect(identityVerified({ ...info, mailFromStatus: 'PENDING' })).toBe(false);
    expect(identityFailed({ ...info, dkimStatus: 'FAILED' })).toBe(true);
    expect(identityFailed({ ...info, mailFromStatus: 'TEMPORARY_FAILURE' })).toBe(false);
  });
});
