import { describe, expect, it } from 'vitest';
import { EmailNotAllowed, logProvider, staffOnly } from '../src';

describe('email', () => {
  it('the log provider writes instead of sending', async () => {
    const lines: string[] = [];
    await logProvider((l) => lines.push(l)).send({ to: 'a@x.com', subject: 'Hi', text: 'Body' });
    expect(lines[0]).toContain('to=a@x.com');
    expect(lines[0]).toContain('Body');
  });

  it('staffOnly refuses any address that is not staff (Rule 10)', async () => {
    const lines: string[] = [];
    const provider = staffOnly(
      logProvider((l) => lines.push(l)),
      ['Editor@Example.com'],
    );
    await provider.send({ to: 'editor@example.com', subject: 's', text: 't' });
    await expect(
      provider.send({ to: 'reader@example.com', subject: 's', text: 't' }),
    ).rejects.toBeInstanceOf(EmailNotAllowed);
    expect(lines).toHaveLength(1);
  });
});
