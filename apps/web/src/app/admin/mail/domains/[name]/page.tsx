import { asc, dnsRecords, domainIdentities, eq, mailDomains, onboardingSteps } from '@towncore/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../../../admin.module.css';
import { requestRecheck } from '../../actions';
import { unpauseAction } from '../../bulk-actions';
import { Pill } from '../../../Pill';

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
      <Link href="/admin/mail/domains" className={styles.back}>
        ← Mail domains
      </Link>
      <header className={styles.pageHead}>
        <div>
          <h1>{domain.name}</h1>
          <p className={styles.muted}>
            {domain.displayName}
            {domain.isTest ? ' · test domain' : ''}
          </p>
        </div>
        <div className={styles.actions}>
          <Pill status={domain.status} />
          <form action={requestRecheck}>
            <input type="hidden" name="name" value={domain.name} />
            <button className={`${styles.button} ${styles.secondary}`} type="submit">
              Re-check SES status
            </button>
          </form>
        </div>
      </header>
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

      <div className={styles.stats} data-testid="bulk-status">
        <div className={styles.stat}>
          <div className={styles.statLabel}>Bulk mail</div>
          <div className={styles.statValue}>
            <Pill status={domain.bulkStatus} />
          </div>
          {domain.pausedReason ? (
            <div className={styles.statNote}>{domain.pausedReason}</div>
          ) : null}
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Daily cap</div>
          <div className={styles.statValue}>{domain.bulkDailyCap.toLocaleString('en-US')}</div>
          <div className={styles.statNote}>
            Target {domain.bulkTargetCap.toLocaleString('en-US')}
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Warm-up day</div>
          <div className={styles.statValue}>{domain.warmupDay}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Daily newsletter</div>
          <div className={styles.statValue}>
            <Pill status={domain.newsletterMode} />
          </div>
          <div className={styles.statNote}>
            {domain.newsletterApprovedAt
              ? `Live since ${domain.newsletterApprovedAt.toISOString().slice(0, 10)}`
              : ''}
            {domain.townId ? (
              <>
                {domain.newsletterApprovedAt ? ' · ' : ''}
                <Link href="/admin/newsletter">Manage in Newsletter</Link>
              </>
            ) : null}
          </div>
        </div>
      </div>
      {me.role === 'admin' && domain.townId && domain.bulkStatus === 'paused' ? (
        <form action={unpauseAction} className={styles.actions}>
          <input type="hidden" name="name" value={domain.name} />
          <input type="hidden" name="domainId" value={domain.id} />
          <button className={styles.button} type="submit">
            Unpause bulk mail
          </button>
        </form>
      ) : null}

      <h2>SES identities</h2>
      <div className={styles.scroll}>
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
                <td className={styles.mono}>{i.identityName}</td>
                <td>{i.verificationStatus ? <Pill status={i.verificationStatus} /> : '–'}</td>
                <td>{i.dkimStatus ? <Pill status={i.dkimStatus} /> : '–'}</td>
                <td>
                  {i.mailFromDomain ?? '–'} {i.mailFromStatus ? `(${i.mailFromStatus})` : ''}
                </td>
                <td>{i.lastCheckedAt?.toISOString().slice(0, 16).replace('T', ' ') ?? '–'}</td>
              </tr>
            ))}
            {identities.length === 0 ? (
              <tr>
                <td colSpan={5} className={styles.muted}>
                  No SES identities yet. Onboarding creates them.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h2>DNS records</h2>
      <div className={styles.scroll}>
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
                <td className={styles.mono}>{r.type}</td>
                <td className={styles.mono}>{r.name || '@'}</td>
                <td>
                  {r.priority !== null ? `${r.priority} ` : ''}
                  <code>{r.value}</code>
                </td>
                <td>
                  <Pill status={r.status} />
                </td>
              </tr>
            ))}
            {records.length === 0 ? (
              <tr>
                <td colSpan={5} className={styles.muted}>
                  No DNS records yet. Onboarding writes them on Vercel.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h2>Onboarding steps</h2>
      <div className={styles.scroll}>
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
                <td>
                  <Pill status={s.status} />
                </td>
                <td>{s.attempts}</td>
                <td>{s.lastError ?? ''}</td>
              </tr>
            ))}
            {steps.length === 0 ? (
              <tr>
                <td colSpan={4} className={styles.muted}>
                  Onboarding has not started.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
