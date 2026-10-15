import { mailEvents, type Db } from '@towncore/db';
import { isSnsUrl, SnsVerificationError, verifySnsMessage, type SigningKeyLoader } from './sns';

// POST /api/mail/sns (brief §4.1 step 4): verify, store once, return fast. Parsing happens in
// the worker. SNS retries anything that isn't a 2xx, so only verification failures and
// malformed bodies are refused for good.

export type WebhookDeps = {
  db: Db;
  allowedTopicArns: readonly string[];
  loadSigningKey: SigningKeyLoader;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
};

export type WebhookResult = { status: number; body: string };

export async function handleSnsWebhook(rawBody: string, deps: WebhookDeps): Promise<WebhookResult> {
  const log = deps.log ?? (() => {});
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: 'invalid JSON' };
  }
  let message;
  try {
    message = await verifySnsMessage(body, deps);
  } catch (error) {
    if (error instanceof SnsVerificationError) {
      log(`[mail] SNS message refused: ${error.message}`);
      return { status: 403, body: 'forbidden' };
    }
    throw error;
  }

  if (message.Type === 'SubscriptionConfirmation') {
    // Verified above, including that SubscribeURL is on an SNS host.
    if (!isSnsUrl(message.SubscribeURL)) return { status: 403, body: 'forbidden' };
    const response = await (deps.fetchImpl ?? fetch)(message.SubscribeURL!, {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { status: 502, body: 'subscription confirmation failed' };
    log(`[mail] confirmed SNS subscription to ${message.TopicArn}`);
  }

  let payload: unknown = { raw: message.Message };
  try {
    payload = JSON.parse(message.Message);
  } catch {
    // Not JSON (e.g. a confirmation text); stored as-is.
  }
  const type =
    message.Type === 'Notification'
      ? String(
          (payload as { notificationType?: string; eventType?: string }).notificationType ??
            (payload as { eventType?: string }).eventType ??
            'unknown',
        )
      : message.Type;
  await deps.db
    .insert(mailEvents)
    .values({
      snsMessageId: message.MessageId,
      topicArn: message.TopicArn,
      type,
      payload: payload as object,
      // Only notifications carry work for the worker.
      status: message.Type === 'Notification' ? 'pending' : 'done',
      processedAt: message.Type === 'Notification' ? null : new Date(),
    })
    .onConflictDoNothing({ target: mailEvents.snsMessageId });
  return { status: 200, body: 'ok' };
}
