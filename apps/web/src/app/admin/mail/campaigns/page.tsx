import {
  asc,
  desc,
  emailCampaigns,
  emailCampaignTemplates,
  eq,
  inArray,
  isNotNull,
  mailDomains,
  and,
} from '@towncore/db';
import { networkBulkPause } from '@towncore/mail';
import Link from 'next/link';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../../admin.module.css';
import {
  createCampaignAction,
  createTemplateAction,
  fanOutAction,
  networkResumeAction,
} from '../bulk-actions';

export const metadata = { title: 'Campaigns' };

type Props = { searchParams: Promise<{ error?: string; done?: string }> };

const BODY_HELP =
  'Markdown. {{site_name}}, {{town_name}} and {{domain}} are filled in per town. The footer (unsubscribe link and postal address) is added automatically.';

// Newsletters and one-off campaigns (Mail-5). A campaign is a draft until an admin approves the
// send (Rule 10, D-MAIL-11).
export default async function Campaigns({ searchParams }: Props) {
  const me = await requireStaff();
  const { error, done } = await searchParams;
  const [campaigns, templates, domains, pause] = await Promise.all([
    db()
      .select({ c: emailCampaigns, domain: mailDomains.name })
      .from(emailCampaigns)
      .innerJoin(mailDomains, eq(mailDomains.id, emailCampaigns.domainId))
      .orderBy(desc(emailCampaigns.createdAt))
      .limit(100),
    db().select().from(emailCampaignTemplates).orderBy(asc(emailCampaignTemplates.name)),
    db()
      .select({
        id: mailDomains.id,
        name: mailDomains.name,
        displayName: mailDomains.displayName,
        bulkStatus: mailDomains.bulkStatus,
      })
      .from(mailDomains)
      .where(and(isNotNull(mailDomains.townId), inArray(mailDomains.status, ['live', 'paused'])))
      .orderBy(asc(mailDomains.name)),
    networkBulkPause(db()),
  ]);
  return (
    <main>
      <h1>Campaigns</h1>
      {pause ? (
        <div className={styles.notice} role="alert">
          <p>Bulk mail is paused for every town: {pause.reason}</p>
          {me.role === 'admin' ? (
            <form action={networkResumeAction}>
              <button className={styles.button} type="submit">
                Resume bulk mail for every town
              </button>
            </form>
          ) : null}
        </div>
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

      <div className={styles.scroll}>
        <table className={styles.table} data-testid="campaigns">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Town</th>
              <th>Kind</th>
              <th>Status</th>
              <th>Scheduled</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map(({ c, domain }) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/admin/mail/campaigns/${c.id}`}>{c.subject}</Link>
                </td>
                <td>{domain}</td>
                <td>{c.kind}</td>
                <td>{c.status}</td>
                <td>
                  {c.scheduledAt
                    ? c.scheduledAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
                    : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {domains.length === 0 ? (
        <p>No town domain is live for mail yet, so there is nowhere to send from.</p>
      ) : (
        <>
          <h2>New campaign</h2>
          <form action={createCampaignAction} className={styles.form}>
            <label htmlFor="c-domain">Town</label>
            <select id="c-domain" name="domainId" required>
              {domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.displayName} ({d.name}, bulk {d.bulkStatus})
                </option>
              ))}
            </select>
            <label htmlFor="c-subject">Subject</label>
            <input id="c-subject" name="subject" required maxLength={200} />
            <label htmlFor="c-body">Message</label>
            <textarea id="c-body" name="body" rows={10} required aria-describedby="c-help" />
            <p id="c-help" className={styles.muted}>
              {BODY_HELP}
            </p>
            <button className={styles.button} type="submit">
              Save draft
            </button>
          </form>

          <h2>From a template</h2>
          {templates.length ? (
            <form action={fanOutAction} className={styles.form}>
              <label htmlFor="t-template">Template</label>
              <select id="t-template" name="templateId" required>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <fieldset>
                <legend>Towns (one draft each)</legend>
                {domains.map((d) => (
                  <label key={d.id} className={styles.check}>
                    <input type="checkbox" name="domainId" value={d.id} /> {d.displayName}
                  </label>
                ))}
              </fieldset>
              <button className={styles.button} type="submit">
                Create drafts
              </button>
            </form>
          ) : (
            <p className={styles.muted}>No templates yet.</p>
          )}
        </>
      )}

      <h2>New template</h2>
      <form action={createTemplateAction} className={styles.form}>
        <label htmlFor="n-name">Name</label>
        <input id="n-name" name="name" required maxLength={100} />
        <label htmlFor="n-subject">Subject</label>
        <input id="n-subject" name="subject" required maxLength={200} />
        <label htmlFor="n-body">Message</label>
        <textarea id="n-body" name="body" rows={8} required />
        <p className={styles.muted}>{BODY_HELP}</p>
        <button className={styles.button} type="submit">
          Save template
        </button>
      </form>
    </main>
  );
}
