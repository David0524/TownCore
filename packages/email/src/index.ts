// Email provider abstraction (CLAUDE.md §3, §11). M3 uses it for staff sign-in links; the
// newsletter (M5) adds bulk sending. The real provider (Resend, D-M3-2) is wired once its
// sending domain's DNS is set up; until then messages go to the server log.

export type EmailMessage = { to: string; subject: string; text: string };

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/** Writes the message to the log instead of sending it (development, CI, and until DNS). */
export function logProvider(log: (line: string) => void = console.info): EmailProvider {
  return {
    name: 'log',
    async send(message) {
      log(
        `[email:log] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`,
      );
    },
  };
}

export class EmailNotAllowed extends Error {}

/**
 * Rule 10: no email to real people without a human approval step. Staff mail is the one
 * standing exception, so this wrapper refuses any address that isn't on the allowed list.
 */
export function staffOnly(provider: EmailProvider, allowed: readonly string[]): EmailProvider {
  const set = new Set(allowed.map((a) => a.toLowerCase()));
  return {
    name: provider.name,
    async send(message) {
      if (!set.has(message.to.toLowerCase())) {
        throw new EmailNotAllowed(`Refusing to email ${message.to}: not a staff address.`);
      }
      await provider.send(message);
    },
  };
}

// The daily newsletter issue (M5).
export * from './newsletter/index';
