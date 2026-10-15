import { inboxFacets, listThreads } from '@towncore/mail';
import Link from 'next/link';
import { inboxHref, parseInboxFilter, type InboxSearchParams } from '@/lib/admin/inbox';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../../admin.module.css';
import { KeyboardNav } from './KeyboardNav';

export const metadata = { title: 'Inbox' };

// The shared inbox (Mail-3): every town address, routed to central teams.
type Props = { searchParams: Promise<InboxSearchParams> };

const STATUS_LABELS: Record<string, string> = {
  active: 'Open + pending',
  open: 'Open',
  pending: 'Pending',
  closed: 'Closed',
  spam: 'Spam',
  all: 'All',
};

const when = (d: Date) =>
  d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });

export default async function Inbox({ searchParams }: Props) {
  const me = await requireStaff();
  const params = await searchParams;
  const filter = parseInboxFilter(params);
  const [{ rows, total, page, pageSize }, facets] = await Promise.all([
    listThreads(db(), me.id, filter),
    inboxFacets(db()),
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <main>
      <KeyboardNav />
      <h1>Inbox</h1>
      <form className={styles.filters} method="get" role="search">
        <label>
          Search
          <input
            name="q"
            type="search"
            defaultValue={filter.q ?? ''}
            placeholder="Contact, subject or town"
          />
        </label>
        <label>
          Status
          <select name="status" defaultValue={filter.status}>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Team
          <select name="team" defaultValue={filter.teamId ?? ''}>
            <option value="">All teams</option>
            {facets.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Town
          <select name="domain" defaultValue={filter.domainId ?? ''}>
            <option value="">All towns</option>
            {facets.domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Assignee
          <select name="assignee" defaultValue={filter.assignee ?? ''}>
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="none">Unassigned</option>
            {facets.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.check}>
          <input type="checkbox" name="unread" value="1" defaultChecked={filter.unreadOnly} />{' '}
          Unread only
        </label>
        <button className={styles.button} type="submit">
          Filter
        </button>
      </form>
      <p className={styles.muted}>
        {total} conversation{total === 1 ? '' : 's'}. Keys: <kbd>j</kbd>/<kbd>k</kbd> move,{' '}
        <kbd>Enter</kbd> opens, <kbd>/</kbd> searches.
      </p>
      <ul className={styles.threadList} data-testid="inbox">
        {rows.map((t) => (
          <li key={t.id} className={t.unread ? styles.unread : undefined}>
            <Link
              href={`/admin/mail/inbox/${t.id}`}
              prefetch={false}
              data-thread-link
              className={styles.threadLink}
            >
              <span className={styles.threadTop}>
                <span>
                  {t.contactName ? `${t.contactName} <${t.contactEmail}>` : t.contactEmail}
                </span>
                <span className={styles.muted}>{when(t.lastMessageAt)}</span>
              </span>
              <span className={styles.threadSubject}>
                {t.unread ? <span className={styles.dot} aria-label="Unread" /> : null}
                {t.subject}
                {t.messageCount > 1 ? (
                  <span className={styles.muted}> ({t.messageCount})</span>
                ) : null}
              </span>
              <span className={styles.muted}>
                {t.townAddress} · {t.teamName} · {t.assigneeName ?? 'Unassigned'} · {t.status}
              </span>
              {t.snippet ? <span className={styles.snippet}>{t.snippet}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
      {rows.length === 0 ? <p>Nothing here.</p> : null}
      {pages > 1 ? (
        <nav className={styles.actions} aria-label="Pages">
          {page > 1 ? (
            <Link href={inboxHref(params, { page: String(page - 1) })}>← Newer</Link>
          ) : null}
          <span className={styles.muted}>
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={inboxHref(params, { page: String(page + 1) })}>Older →</Link>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
