import { mailDomains, signatures } from '@towncore/db';
import {
  getThread,
  hasRemoteImages,
  inboxFacets,
  markRead,
  messageDocument,
  parseAddress,
  pickSignature,
  renderSignature,
  replyRecipients,
  replySubject,
  suppressedAddresses,
  threadStatuses,
} from '@towncore/mail';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { inlineImageUrl } from '@/lib/admin/inbox';
import { adminBaseUrl, requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../../../admin.module.css';
import { sendReplyAction } from '../../compose/actions';
import { Composer } from '../../compose/Composer';
import {
  assignAction,
  moveTeamAction,
  noteAction,
  statusAction,
  suppressContactAction,
} from '../actions';
import { ThreadKeys } from '../KeyboardNav';

export const metadata = { title: 'Conversation' };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ images?: string; error?: string; sent?: string; reply?: string }>;
};

const when = (d: Date) =>
  d.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/New_York',
  });

const FAILS = (m: {
  spfVerdict: string | null;
  dkimVerdict: string | null;
  dmarcVerdict: string | null;
}) =>
  (['spf', 'dkim', 'dmarc'] as const)
    .filter((k) => m[`${k}Verdict`] === 'FAIL')
    .map((k) => k.toUpperCase());

export default async function Conversation({ params, searchParams }: Props) {
  const me = await requireStaff();
  const { id } = await params;
  const { images, error, sent, reply } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [thread, facets] = await Promise.all([getThread(db(), id), inboxFacets(db())]);
  if (!thread) notFound();
  await markRead(db(), id, me.id);
  const t = thread.thread;
  const hidden = <input type="hidden" name="threadId" value={t.id} />;
  const [contactSuppressed] = thread.contactEmail
    ? await suppressedAddresses(db(), [thread.contactEmail], {
        domainId: t.domainId,
        stream: 'conversational',
      })
    : [];

  // Reply defaults: answer the last message from outside; "Reply all" adds its other people.
  const [domainRows, sigRows] = await Promise.all([
    db().select({ name: mailDomains.name }).from(mailDomains),
    db().select().from(signatures),
  ]);
  const lastInbound = [...thread.messages].reverse().find((m) => m.direction === 'inbound');
  const recipients = lastInbound
    ? replyRecipients(lastInbound, {
        mode: reply === 'all' ? 'replyAll' : 'reply',
        ourDomains: new Set(domainRows.map((d) => d.name)),
      })
    : { to: [thread.contactEmail], cc: [] };
  const role = parseAddress(t.townAddress)?.role ?? '';
  const signature = renderSignature(pickSignature(sigRows, me.id, role), {
    town_name: thread.displayName,
    user_name: me.name,
    role,
    domain: thread.domainName,
  });

  return (
    <main>
      <ThreadKeys backHref="/admin/mail/inbox" />
      <p>
        <Link href="/admin/mail/inbox">← Inbox</Link> <span className={styles.muted}>(u)</span>
      </p>
      <h1>{t.subject}</h1>
      <p className={styles.muted} data-testid="thread-meta">
        {thread.contactName
          ? `${thread.contactName} <${thread.contactEmail}>`
          : thread.contactEmail}{' '}
        → {t.townAddress} ({thread.displayName}) · {thread.teamName} ·{' '}
        {thread.assigneeName ?? 'Unassigned'} · {t.status}
      </p>
      {error ? (
        <p className={styles.notice} role="alert">
          {error}
        </p>
      ) : null}
      {sent ? (
        <p className={styles.notice} role="status">
          Sent from {t.townAddress}.
        </p>
      ) : null}

      <div className={styles.actions} data-testid="thread-actions">
        <form action={assignAction} className={styles.inline}>
          {hidden}
          <label>
            Assign{' '}
            <select name="assignee" defaultValue={t.assigneeId ?? ''}>
              <option value="">Unassigned</option>
              {facets.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button className={`${styles.button} ${styles.secondary}`} type="submit">
            Assign
          </button>
        </form>
        {t.assigneeId !== me.id ? (
          <form action={assignAction}>
            {hidden}
            <input type="hidden" name="assignee" value="me" />
            <button className={`${styles.button} ${styles.secondary}`} type="submit">
              Assign to me
            </button>
          </form>
        ) : null}
        <form action={statusAction} className={styles.inline}>
          {hidden}
          <label>
            Status{' '}
            <select name="status" defaultValue={t.status}>
              {threadStatuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <button className={`${styles.button} ${styles.secondary}`} type="submit">
            Set status
          </button>
        </form>
        <form action={moveTeamAction} className={styles.inline}>
          {hidden}
          <label>
            Team{' '}
            <select name="teamId" defaultValue={t.teamId}>
              {facets.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          <button className={`${styles.button} ${styles.secondary}`} type="submit">
            Move
          </button>
        </form>
        <form action={statusAction}>
          {hidden}
          <input type="hidden" name="status" value={t.status === 'spam' ? 'open' : 'spam'} />
          <button className={`${styles.button} ${styles.secondary}`} type="submit">
            {t.status === 'spam' ? 'Not spam' : 'Mark spam'}
          </button>
        </form>
        {contactSuppressed ? (
          <span className={styles.muted} data-testid="contact-suppressed">
            Not emailed: {contactSuppressed.reason.replace('_', ' ')}
          </span>
        ) : thread.contactEmail ? (
          <form action={suppressContactAction}>
            {hidden}
            <button className={`${styles.button} ${styles.secondary}`} type="submit">
              Don&apos;t email {thread.contactEmail} again
            </button>
          </form>
        ) : null}
      </div>

      {thread.messages.map((m) => {
        const fails = FAILS(m);
        const allowRemote = images === m.id || images === 'all';
        const inline = new Map(
          m.attachments.filter((a) => a.contentId && a.s3Key).map((a) => [a.contentId!, a.id]),
        );
        return (
          <article key={m.id} className={styles.message} data-testid="message">
            <header className={styles.messageHead}>
              <strong>
                {m.direction === 'outbound'
                  ? `${m.fromAddress} (us)`
                  : m.fromName
                    ? `${m.fromName} <${m.fromAddress}>`
                    : m.fromAddress}
              </strong>
              <span className={styles.muted}>{when(m.sentAt)}</span>
              <span className={styles.muted}>
                To {m.toAddresses.join(', ') || m.envelopeRecipient}
                {m.ccAddresses.length ? ` · Cc ${m.ccAddresses.join(', ')}` : ''}
                {m.envelopeRecipient && !m.toAddresses.includes(m.envelopeRecipient)
                  ? ` · delivered to ${m.envelopeRecipient}`
                  : ''}
              </span>
              <span className={styles.badges}>
                {m.direction === 'outbound' ? (
                  <span className={styles.badge} data-testid="delivery-status">
                    {m.deliveryStatus ?? 'unknown'}
                    {m.deliveryError ? `: ${m.deliveryError}` : ''}
                  </span>
                ) : null}
                {m.spamVerdict === 'FAIL' ? (
                  <span className={styles.badge}>Spam verdict</span>
                ) : null}
                {m.isAutomated ? <span className={styles.badge}>Automated</span> : null}
                {m.quarantined ? <span className={styles.badge}>Virus: quarantined</span> : null}
                {fails.length ? (
                  <span className={styles.badge}>{fails.join(', ')} failed</span>
                ) : null}
              </span>
            </header>
            {m.htmlBodySanitized ? (
              <>
                {hasRemoteImages(m.htmlBodySanitized) && !allowRemote ? (
                  <p className={styles.muted}>
                    Remote images are blocked.{' '}
                    <Link href={`/admin/mail/inbox/${t.id}?images=${m.id}`}>
                      Load remote images
                    </Link>
                  </p>
                ) : null}
                <iframe
                  className={styles.messageFrame}
                  title={`Message from ${m.fromAddress}`}
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  referrerPolicy="no-referrer"
                  srcDoc={messageDocument(m.htmlBodySanitized, {
                    adminOrigin: new URL(adminBaseUrl()).origin,
                    allowRemoteImages: allowRemote,
                    inlineUrl: (cid) => {
                      const attachmentId = inline.get(cid);
                      return attachmentId ? inlineImageUrl(attachmentId) : null;
                    },
                  })}
                />
              </>
            ) : (
              <pre className={styles.messageText}>{m.textBody ?? '(no text)'}</pre>
            )}
            {m.attachments.length ? (
              <ul className={styles.attachments} data-testid="attachments">
                {m.attachments.map((a) => (
                  <li key={a.id}>
                    {a.s3Key && !m.quarantined ? (
                      <a href={`/admin/mail/attachments/${a.id}`}>{a.filename}</a>
                    ) : (
                      <span>
                        {a.filename} <span className={styles.muted}>(withheld: virus)</span>
                      </span>
                    )}{' '}
                    <span className={styles.muted}>
                      {a.contentType}, {Math.max(1, Math.round(a.size / 1024))} KB
                      {a.inline ? ', inline' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        );
      })}

      <section aria-labelledby="reply-heading">
        <h2 id="reply-heading">
          {reply === 'all' ? 'Reply all' : 'Reply'} from {t.townAddress}
        </h2>
        <p className={styles.actions}>
          <Link href={`/admin/mail/inbox/${t.id}`}>Reply</Link>
          <Link href={`/admin/mail/inbox/${t.id}?reply=all`}>Reply all</Link>
        </p>
        <Composer
          key={reply ?? 'reply'}
          action={sendReplyAction}
          hidden={{ threadId: t.id }}
          defaults={{
            to: recipients.to.join(', '),
            cc: recipients.cc.join(', '),
            subject: replySubject(t.subject),
          }}
          signature={signature}
          submitLabel="Send reply"
        />
      </section>

      <section aria-labelledby="notes-heading">
        <h2 id="notes-heading">Internal notes</h2>
        <p className={styles.muted}>Only staff see these. They are never emailed.</p>
        <ul className={styles.notes} data-testid="notes">
          {thread.notes.map(({ note, staffName }) => (
            <li key={note.id}>
              <strong>{staffName}</strong>{' '}
              <span className={styles.muted}>{when(note.createdAt)}</span>
              <p>{note.body}</p>
            </li>
          ))}
        </ul>
        <form action={noteAction} className={styles.form}>
          {hidden}
          <label htmlFor="note">Add a note</label>
          <textarea id="note" name="body" rows={3} required maxLength={10000} />
          <div className={styles.actions}>
            <button className={styles.button} type="submit">
              Add note
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
