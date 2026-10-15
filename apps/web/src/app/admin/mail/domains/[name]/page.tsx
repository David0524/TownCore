import { asc, dnsRecords, domainIdentities, eq, mailDomains, onboardingSteps } from '@towncore/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../../../admin.module.css';
import { requestRecheck } from '../../actions';
import { unpauseAction } from '../../bulk-actions';

export const metadata = { title: 'Mail domain' };

type Props = {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ recheck?: string; error?: string; done?: string }>;
};

export default async function MailDomain({ params, searchParams }: Props) {
  const me = await requireStaff();
  const name = decodeURIComponent((await params).name);
  const { recheck, error, done } = await searchParams;
  const [domain] = await db().select().from(mailDomains).where(eq(mailDomains.name, name));
  if (!domain) notFound();
  const [identities, records, steps] = await Promise.all([
    db().select().from(domainIdentities).where(eq(domainIdentities.domainId, domain.id)),
    db()
      .select()
      .from(dnsRecords)
      .where(eq(dnsRecords.domainId, domain.id))
      .orderBy(asc(dnsRecords.name), asc(dnsRecords.type)),
    db()
      .select()
      .from(onboardingSteps)
      .where(eq(onboardingSteps.domainId, domain.id))
      .orderBy(asc(onboardingSteps.createdAt)),
  ]);
  return (
    <main>
      <p>
        <Link href="/admin/mail/domains">← Mail domains</Link>
      </p>
      <h1>{domain.name}</h1>
      <p>
        {domain.displayName} · {domain.status}
        {domain.isTest ? ' · test domain' : ''}
      </p>
      {domain.failureReason ? (
        <p className={styles.notice} role="alert">
          {domain.failureReason}
        </p>
      ) : null}
      {recheck || domain.recheckRequestedAt ? (
        <p className={styles.notice} role="status">
          Re-check requested; the worker checks SES within 5 minutes.
        </p>
      ) : null}
      <form action={requestRecheck} className={styles.actions}>
        <input type="hidden" name="name" value={domain.name} />
        <button className={styles.button} type="submit">
          Re-check SES status
        </button>
      </form>

      <h2>Bulk mail</h2>
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
      <p data-testid="bulk-status">
        {domain.bulkStatus} · cap {domain.bulkDailyCap} a day (target {domain.bulkTargetCap}) ·
        warm-up day {domain.warmupDay}
        {domain.pausedReason ? ` · ${domain.pausedReason}` : ''}
      </p>
      <p>
        Daily newsletter: {domain.newsletterMode}
        {domain.newsletterApprovedAt
          ? ` (live since ${domain.newsletterApprovedAt.toISOString().slice(0, 10)})`
          : ''}
        {domain.townId ? (
          <>
            {' '}
            · <Link href="/admin/newsletter">Manage in Newsletter</Link>
          </>
        ) : null}
      </p>
      {me.role === 'admin' && domain.townId ? (
        <div className={styles.actions}>
          {domain.bulkStatus === 'paused' ? (
            <form action={unpauseAction}>
              <input type="hidden" name="name" value={domain.name} />
              <input type="hidden" name="domainId" value={domain.id} />
              <button className={styles.button} type="submit">
                Unpause bulk mail
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      <h2>SES identities</h2>
      <table className={styles.table} data-testid="mail-identities">
        <thead>
          <tr>
            <th>Identity</th>
            <th>Verification</th>
            <th>DKIM</th>
            <th>MAIL FROM</th>
            <th>Checked</th>
          </tr>
        </thead>
        <tbody>
          {identities.map((i) => (
            <tr key={i.id}>
              <td>{i.identityName}</td>
              <td>{i.verificationStatus ?? '–'}</td>
              <td>{i.dkimStatus ?? '–'}</td>
              <td>
                {i.mailFromDomain ?? '–'} {i.mailFromStatus ? `(${i.mailFromStatus})` : ''}
              </td>
              <td>{i.lastCheckedAt?.toISOString().slice(0, 16).replace('T', ' ') ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>DNS records</h2>
      <table className={styles.table} data-testid="mail-records">
        <thead>
          <tr>
            <th>Purpose</th>
            <th>Type</th>
            <th>Name</th>
            <th>Value</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id}>
              <td>{r.purpose.replace(/_/g, ' ')}</td>
              <td>{r.type}</td>
              <td>{r.name || '@'}</td>
              <td>
                {r.priority !== null ? `${r.priority} ` : ''}
                <code>{r.value}</code>
              </td>
              <td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Onboarding steps</h2>
      <table className={styles.table} data-testid="mail-steps">
        <thead>
          <tr>
            <th>Step</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Last error</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s) => (
            <tr key={s.id}>
              <td>{s.step.replace(/_/g, ' ')}</td>
              <td>{s.status}</td>
              <td>{s.attempts}</td>
              <td>{s.lastError ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
