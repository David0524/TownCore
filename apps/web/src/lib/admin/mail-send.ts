import { loadEnv } from '@towncore/config';
import {
  logTransport,
  MAX_ATTACHMENT_BYTES,
  parseRecipientList,
  s3MailStore,
  sesTransport,
  type OutboundAttachment,
  type SendDeps,
} from '@towncore/mail';
import { db } from '@/lib/db';

// Outbound mail from the admin (Mail-4). Without a transport the composer explains why it
// can't send instead of failing at the last step.

export function sendDeps(): SendDeps | { unavailable: string } {
  const env = loadEnv();
  const region = env.AWS_REGION ?? 'us-east-1';
  const mode = env.MAIL_TRANSPORT ?? (env.AWS_ACCESS_KEY_ID ? 'ses' : null);
  if (!mode)
    return { unavailable: 'Sending isn’t set up yet (no AWS credentials or MAIL_TRANSPORT).' };
  if (mode === 'ses' && !env.SES_CONFIG_SET_CONVERSATIONAL)
    return { unavailable: 'Sending isn’t set up yet (SES_CONFIG_SET_CONVERSATIONAL is missing).' };
  const bucket = env.MAIL_S3_BUCKET;
  const store = bucket && env.AWS_ACCESS_KEY_ID ? s3MailStore({ region, bucket }) : null;
  return {
    db: db(),
    transport: mode === 'log' ? logTransport() : sesTransport({ region }),
    files: store ? { put: (key, body, type) => store.putAttachment(key, body, type) } : null,
    region,
    configurationSet: env.SES_CONFIG_SET_CONVERSATIONAL ?? 'log',
  };
}

export type ComposeState = {
  error?: string;
  /** Recipients on the suppression list: the form shows them and a confirm box. */
  suppressed?: { email: string; reason: string }[];
  values?: { to: string; cc: string; subject: string; body: string };
} | null;

/** Reads the shared composer fields from a form submission. */
export async function readDraft(form: FormData) {
  const to = parseRecipientList(String(form.get('to') ?? ''));
  const cc = parseRecipientList(String(form.get('cc') ?? ''));
  const files = form
    .getAll('attachments')
    .filter((f): f is File => f instanceof File && f.size > 0);
  const total = files.reduce((n, f) => n + f.size, 0);
  const attachments: OutboundAttachment[] =
    total > MAX_ATTACHMENT_BYTES
      ? []
      : await Promise.all(
          files.map(async (f) => ({
            filename: f.name,
            contentType: f.type || 'application/octet-stream',
            content: Buffer.from(await f.arrayBuffer()),
          })),
        );
  return {
    to,
    cc,
    tooBig: total > MAX_ATTACHMENT_BYTES,
    subject: String(form.get('subject') ?? ''),
    body: String(form.get('body') ?? ''),
    attachments,
    confirmSuppressed: form.get('confirmSuppressed') === 'yes',
    values: {
      to: String(form.get('to') ?? ''),
      cc: String(form.get('cc') ?? ''),
      subject: String(form.get('subject') ?? ''),
      body: String(form.get('body') ?? ''),
    },
  };
}
