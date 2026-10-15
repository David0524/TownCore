import { createPublicKey, verify, X509Certificate, type KeyObject } from 'node:crypto';
import { z } from 'zod';

// Amazon SNS message verification (brief §10: webhooks accept only verified SNS messages).
// Checked against the SNS docs on 2026-10-15: sign the listed fields as "Name\nValue\n" in
// order, SHA1 for SignatureVersion 1 and SHA256 for 2; fetch the certificate only over HTTPS
// from an SNS host; reject unexpected topics.

export const snsMessageSchema = z.object({
  Type: z.enum(['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation']),
  MessageId: z.string().min(1),
  TopicArn: z.string().min(1),
  Message: z.string(),
  Timestamp: z.string(),
  SignatureVersion: z.enum(['1', '2']),
  Signature: z.string().min(1),
  SigningCertURL: z.string(),
  Subject: z.string().optional(),
  SubscribeURL: z.string().optional(),
  Token: z.string().optional(),
  UnsubscribeURL: z.string().optional(),
});
export type SnsMessage = z.infer<typeof snsMessageSchema>;

export class SnsVerificationError extends Error {}

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

/** An https URL on an SNS endpoint host (certificates, subscribe links). */
export function isSnsUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && SNS_HOST.test(url.hostname) && !url.username && !url.port;
  } catch {
    return false;
  }
}

export function stringToSign(m: SnsMessage): string {
  const fields: (keyof SnsMessage)[] =
    m.Type === 'Notification'
      ? [
          'Message',
          'MessageId',
          ...(m.Subject !== undefined ? (['Subject'] as const) : []),
          'Timestamp',
          'TopicArn',
          'Type',
        ]
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  return fields.map((f) => `${f}\n${m[f] ?? ''}\n`).join('');
}

export type SigningKeyLoader = (certUrl: string) => Promise<KeyObject>;

export async function verifySnsMessage(
  body: unknown,
  options: { allowedTopicArns: readonly string[]; loadSigningKey: SigningKeyLoader },
): Promise<SnsMessage> {
  const parsed = snsMessageSchema.safeParse(body);
  if (!parsed.success) throw new SnsVerificationError('not an SNS message');
  const m = parsed.data;
  if (!options.allowedTopicArns.includes(m.TopicArn))
    throw new SnsVerificationError(`unexpected topic ${m.TopicArn}`);
  if (!isSnsUrl(m.SigningCertURL) || !new URL(m.SigningCertURL).pathname.endsWith('.pem'))
    throw new SnsVerificationError('signing certificate is not on an SNS host');
  if (m.Type !== 'Notification' && !isSnsUrl(m.SubscribeURL))
    throw new SnsVerificationError('subscribe URL is not on an SNS host');
  const key = await options.loadSigningKey(m.SigningCertURL);
  const algorithm = m.SignatureVersion === '1' ? 'sha1' : 'sha256';
  const ok = verify(
    algorithm,
    Buffer.from(stringToSign(m), 'utf8'),
    key,
    Buffer.from(m.Signature, 'base64'),
  );
  if (!ok) throw new SnsVerificationError('bad signature');
  return m;
}

/**
 * Fetches the signing certificate over HTTPS (TLS-verified) from the SNS host the URL names,
 * checks it is current and issued for SNS, and caches its key.
 */
export function httpsSigningKeyLoader(
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): SigningKeyLoader {
  const cache = new Map<string, { key: KeyObject; validTo: Date }>();
  return async (certUrl) => {
    const cached = cache.get(certUrl);
    if (cached && cached.validTo > now()) return cached.key;
    if (!isSnsUrl(certUrl))
      throw new SnsVerificationError('signing certificate is not on an SNS host');
    const response = await fetchImpl(certUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new SnsVerificationError(`certificate fetch failed: ${response.status}`);
    const cert = new X509Certificate(await response.text());
    const validTo = new Date(cert.validTo);
    if (new Date(cert.validFrom) > now() || validTo < now())
      throw new SnsVerificationError('signing certificate is not currently valid');
    if (!/sns\.amazonaws\.com/i.test(cert.subject))
      throw new SnsVerificationError('signing certificate is not for SNS');
    const key = createPublicKey(cert.publicKey.export({ type: 'spki', format: 'pem' }));
    cache.set(certUrl, { key, validTo });
    return key;
  };
}
