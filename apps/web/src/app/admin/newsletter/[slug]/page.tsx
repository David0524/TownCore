import { asc, eq, getTownBySlug, mailDomains, newsletterTesters, staff } from '@towncore/db';
import {
  gatherIssue,
  recentIssues,
  renderIssue,
  TEST_ISSUES_BEFORE_LIVE,
  testIssuesSent,
} from '@towncore/email';
import { campaignPreviewHtml } from '@towncore/mail';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../../admin.module.css';
import { setModeAction, setTesterAction, testSendNextAction } from '../actions';

export const metadata = { title: 'Town newsletter' };

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; done?: string; issue?: string }>;
};

const MODES = [
  { mode: 'off', label: 'Turn off' },
  { mode: 'test', label: 'Send to the test list' },
  { mode: 'live', label: 'Go live: send to every subscriber' },
] as const;

export default async function TownNewsletter({ params, searchParams }: Props) {
  const me = await requireStaff();
  const { slug } = await params;
  const { error, done, issue: issueId } = await searchParams;
  const town = await getTownBySlug(db(), slug);
  if (!town) notFound();
  const [domain] = await db().select().from(mailDomains).where(eq(mailDomains.townId, town.id));
  if (!domain) notFound();
  const [issues, testsSent, people, testerRows, next] = await Promise.all([
    recentIssues(db(), town.id),
    testIssuesSent(db(), town.id),
    db().select().from(staff).where(eq(staff.active, true)).orderBy(asc(staff.name)),
    db().select().from(newsletterTesters).where(eq(newsletterTesters.domainId, domain.id)),
    gatherIssue(db(), town).then(renderIssue),
  ]);
  const testers = new Set(testerRows.map((t) => t.staffId));
  const shown = issueId ? issues.find((i) => i.id === issueId) : undefined;
  const hidden = (
    <>
      <input type="hidden" name="slug" value={town.slug} />
      <input type="hidden" name="domainId" value={domain.id} />
    </>
  );
  return (
    <main>
      <p>
        <Link href="/admin/newsletter">← Newsletter</Link>
      </p>
      <h1>{town.siteName}</h1>
      {error ? (
        <p className={styles.notice} role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className={styles.notice} role="status">
          {done}
        </p>
      ) : null}
      <p data-testid="newsletter-mode">
        Mode: <strong>{domain.newsletterMode}</strong> · sends at{' '}
        {(town.config as { newsletter_send_time?: string }).newsletter_send_time} ({town.timezone})
        · {testsSent} test issue(s) sent · bulk {domain.bulkStatus}
      </p>
      {me.role === 'admin' ? (
        <div className={styles.actions}>
          {MODES.filter((m) => m.mode !== domain.newsletterMode).map((m) => (
            <form key={m.mode} action={setModeAction}>
              {hidden}
              <input type="hidden" name="mode" value={m.mode} />
              <button
                className={m.mode === 'live' ? styles.button : styles.secondary}
                type="submit"
              >
                {m.label}
              </button>
            </form>
          ))}
        </div>
      ) : (
        <p className={styles.muted}>An admin changes the mode.</p>
      )}
      {domain.newsletterMode !== 'live' ? (
        <p className={styles.muted}>
          Going live needs at least {TEST_ISSUES_BEFORE_LIVE} test issues sent first.
        </p>
      ) : null}

      <h2>Test list</h2>
      <ul className={styles.notes} data-testid="test-list">
        {people.map((p) => (
          <li key={p.id}>
            <form action={setTesterAction} className={styles.inline}>
              {hidden}
              <input type="hidden" name="staffId" value={p.id} />
              <input type="hidden" name="on" value={testers.has(p.id) ? 'no' : 'yes'} />
              {p.name} ({p.email}) {testers.has(p.id) ? '· on the test list ' : ''}
              <button className={styles.secondary} type="submit">
                {testers.has(p.id) ? 'Remove' : 'Add'}
              </button>
            </form>
          </li>
        ))}
      </ul>

      <h2>Next issue (as of now)</h2>
      <p data-testid="next-subject">
        <strong>{next.subject}</strong> · {next.preheader}
      </p>
      <form action={testSendNextAction}>
        {hidden}
        <button className={styles.secondary} type="submit">
          Send a test to me
        </button>
      </form>
      <iframe
        className={styles.messageFrame}
        title="Next issue preview"
        sandbox=""
        srcDoc={campaignPreviewHtml(next.html)}
        data-testid="next-preview"
      />

      <h2>Past issues</h2>
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="past-issues">
          <thead>
            <tr>
              <th>Date</th>
              <th>Mode</th>
              <th>Subject</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((i) => (
              <tr key={i.id}>
                <td>{i.date}</td>
                <td>{i.mode}</td>
                <td>
                  {i.html ? (
                    <Link href={`/admin/newsletter/${town.slug}?issue=${i.id}`}>{i.subject}</Link>
                  ) : (
                    '–'
                  )}
                </td>
                <td>
                  {i.skippedReason
                    ? `skipped: ${i.skippedReason}`
                    : i.stats
                      ? Object.entries(i.stats as Record<string, number>)
                          .map(([k, v]) => `${v} ${k}`)
                          .join(' · ')
                      : i.sentAt
                        ? 'sent'
                        : 'not sent'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown?.html ? (
        <>
          <h2>{shown.subject}</h2>
          <iframe
            className={styles.messageFrame}
            title="Past issue"
            sandbox=""
            srcDoc={campaignPreviewHtml(shown.html)}
          />
        </>
      ) : null}
    </main>
  );
}
