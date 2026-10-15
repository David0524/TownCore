'use client';

import { useActionState, type ReactNode } from 'react';
import type { ComposeState } from '@/lib/admin/mail-send';
import styles from '../../admin.module.css';

// The shared reply / new-message form (Mail-4). Keeps what was typed when the server says
// no, and shows the suppression warning with a box to send anyway.
export function Composer({
  action,
  hidden,
  extra,
  defaults,
  signature,
  submitLabel,
}: {
  action: (prev: ComposeState, form: FormData) => Promise<ComposeState>;
  hidden: Record<string, string>;
  extra?: ReactNode;
  defaults: { to: string; cc: string; subject: string };
  signature: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<ComposeState, FormData>(action, null);
  const v = state?.values;
  return (
    <form action={formAction} className={styles.form} data-testid="composer">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {extra}
      <label htmlFor="compose-to">To</label>
      <input id="compose-to" name="to" defaultValue={v?.to ?? defaults.to} required />
      <label htmlFor="compose-cc">Cc</label>
      <input id="compose-cc" name="cc" defaultValue={v?.cc ?? defaults.cc} />
      <label htmlFor="compose-subject">Subject</label>
      <input
        id="compose-subject"
        name="subject"
        defaultValue={v?.subject ?? defaults.subject}
        required
      />
      <label htmlFor="compose-body">Message</label>
      <textarea id="compose-body" name="body" rows={8} defaultValue={v?.body ?? ''} required />
      <p className={styles.muted}>
        Signature: <span className={styles.signature}>{signature}</span>
      </p>
      <label htmlFor="compose-files">Attachments (10 MB total)</label>
      <input id="compose-files" name="attachments" type="file" multiple />
      {state?.error ? (
        <p className={styles.notice} role="alert">
          {state.error}
        </p>
      ) : null}
      {state?.suppressed?.length ? (
        <label className={styles.check}>
          <input type="checkbox" name="confirmSuppressed" value="yes" /> Send anyway to{' '}
          {state.suppressed.map((s) => s.email).join(', ')}
        </label>
      ) : null}
      <div className={styles.actions}>
        <button className={styles.button} type="submit" disabled={pending}>
          {pending ? 'Sending…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
