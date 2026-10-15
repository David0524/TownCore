import { loadEnv } from '@towncore/config';
import { handleSnsWebhook, httpsSigningKeyLoader } from '@towncore/mail';
import { db } from '@/lib/db';

// SES → SNS → here (docs/plans/MAIL.md, Mail-2). Served only on the admin host (proxy.ts).
// Verifies the SNS signature and topic, stores the notification once, and returns; the worker
// does the parsing.
const loadSigningKey = httpsSigningKeyLoader();

export async function POST(request: Request) {
  const result = await handleSnsWebhook(await request.text(), {
    db: db(),
    allowedTopicArns: loadEnv().MAIL_SNS_TOPIC_ARNS ?? [],
    loadSigningKey,
    log: (line) => console.warn(line),
  });
  return new Response(result.body, { status: result.status });
}
