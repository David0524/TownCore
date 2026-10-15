import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { publisher } from '@towncore/config';
import { newMessageId } from '../outbound/mime';
import type { MailTransport } from '../outbound/transport';

// Internal mail to staff (alerts). Like sign-in links, it is the one standing exception to
// Rule 10 for automatic mail, so code refuses any recipient outside the company domain.

export const ALERT_FROM = `TownCore alerts <alerts@${publisher.hqDomain}>`;

export class NotStaffAddress extends Error {}

export async function sendStaffEmail(
  transport: MailTransport,
  configurationSet: string,
  message: { to: string[]; subject: string; text: string },
): Promise<void> {
  const suffix = `@${publisher.hqDomain}`;
  const outside = message.to.filter((a) => !a.toLowerCase().endsWith(suffix));
  if (outside.length)
    throw new NotStaffAddress(`Refusing to send staff mail to ${outside.join(', ')}`);
  if (!message.to.length) return;
  const raw = await new Promise<Buffer>((resolve, reject) =>
    new MailComposer({
      from: ALERT_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      messageId: `<${newMessageId(publisher.hqDomain)}>`,
      headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
    })
      .compile()
      .build((error, built) => (error ? reject(error) : resolve(built))),
  );
  await transport.send({
    raw,
    from: `alerts@${publisher.hqDomain}`,
    to: message.to,
    cc: [],
    configurationSet,
    tags: { stream: 'staff', kind: 'alert' },
  });
}
