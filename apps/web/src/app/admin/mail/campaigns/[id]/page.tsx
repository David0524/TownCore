import { emailCampaigns, emailCampaignSends, eq, mailDomains, sql, staff } from '@towncore/db';
import { campaignPreviewHtml } from '@towncore/mail';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../../../admin.module.css';
import {
  approveAction,
  cancelAction,
  pauseAction,
  resumeAction,
  testSendAction,
} from '../../bulk-actions';

export const metadata = { title: 'Campaign' };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
};

export default async function Campaign({ params, searchParams }: Props) {
  const me = await requireStaff();
  const { id } = await params;
  const { error, done } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [row] = await db()
    .select({ c: emailCampaigns, domain: mailDomains })
    .from(emailCampaigns)
    .innerJoin(mailDomains, eq(mailDomains.id, emailCampaigns.domainId))
    .where(eq(emailCampaigns.id, id));
  if (!row) notFound();
  const { c, domain } = row;
  const [counts, approver] = await Promise.all([
    db()
      .select({ status: emailCampaignSends.status, n: sql<number>`count(*)::int` })
      .from(emailCampaignSends)
      .where(eq(emailCampaignSends.campaignId, id))
      .groupBy(emailCampaignSends.status),
    c.approvedBy
      ? db().select({ name: staff.name }).from(staff).where(eq(staff.id, c.approvedBy))
      : Promise.resolve([]),
  ]);
  const preview = campaignPreviewHtml(c.html);
  const hidden = <input type="hidden" name="id" value={c.id} />;
  return (
    <main>
      <p>
        <Link href="/admin/mail/campaigns">← Campaigns</Link>
      </p>
      <h1>{c.subject}</h1>
      <p data-testid="campaign-meta">
        {domain.displayName} ({domain.name}) · {c.kind} · <strong>{c.status}</strong>
        {c.scheduledAt
          ? ` · scheduled ${c.scheduledAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`
          : ''}
        {approver[0] ? ` · approved by ${approver[0].name}` : ''}
        {c.pausedReason ? ` · ${c.pausedReason}` : ''}
      </p>
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
      {counts.length ? (
        <p data-testid="campaign-counts">{counts.map((k) => `${k.n} ${k.status}`).join(' · ')}</p>
      ) : null}

      <div className={styles.actions}>
        <form action={testSendAction}>
          {hidden}
          <button className={styles.secondary} type="submit">
            Send a test to me
          </button>
        </form>
        {c.status === 'draft' && me.role === 'admin' ? (
          <form action={approveAction} className={styles.inline}>
            {hidden}
            <label>
              Send at, UTC (blank = now) <input type="datetime-local" name="when" />
            </label>
            <button className={styles.button} type="submit">
              Approve send
            </button>
          </form>
        ) : null}
        {c.status === 'draft' && me.role !== 'admin' ? (
          <p className={styles.muted}>An admin approves the send.</p>
        ) : null}
        {c.status === 'scheduled' || c.status === 'sending' ? (
          <form action={pauseAction}>
            {hidden}
            <button className={styles.secondary} type="submit">
              Pause
            </button>
          </form>
        ) : null}
        {c.status === 'paused' ? (
          <form action={resumeAction}>
            {hidden}
            <button className={styles.button} type="submit">
              Resume
            </button>
          </form>
        ) : null}
        {['draft', 'scheduled', 'sending', 'paused'].includes(c.status) ? (
          <form action={cancelAction}>
            {hidden}
            <button className={styles.secondary} type="submit">
              Cancel campaign
            </button>
          </form>
        ) : null}
      </div>

      <h2>Preview</h2>
      <iframe
        className={styles.messageFrame}
        title="Campaign preview"
        sandbox=""
        srcDoc={preview}
        data-testid="campaign-preview"
      />
      <h2>Plain text</h2>
      <pre className={styles.messageText}>{c.text}</pre>
    </main>
  );
}
