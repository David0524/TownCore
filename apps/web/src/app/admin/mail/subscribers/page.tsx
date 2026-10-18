import { and, asc, desc, eq, ilike, sql, subscribers, towns } from '@towncore/db';
import Link from 'next/link';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../../admin.module.css';
import { Pill } from '../../Pill';
import { unsubscribeAction } from '../bulk-actions';

export const metadata = { title: 'Subscribers' };

const STATUSES = ['active', 'pending', 'unsubscribed', 'bounced', 'complained'] as const;
type Status = (typeof STATUSES)[number];

type Props = {
  searchParams: Promise<{ town?: string; status?: string; q?: string; done?: string }>;
};

// Newsletter subscribers per town (Mail-5): list, search, export, manual unsubscribe.
export default async function Subscribers({ searchParams }: Props) {
  await requireStaff();
  const params = await searchParams;
  const allTowns = await db()
    .select({ id: towns.id, siteName: towns.siteName, slug: towns.slug })
    .from(towns)
    .orderBy(asc(towns.siteName));
  const town = allTowns.find((t) => t.slug === params.town) ?? allTowns[0];
  const status = STATUSES.includes(params.status as Status) ? (params.status as Status) : undefined;
  const q = (params.q ?? '').trim();
  const where = and(
    town ? eq(subscribers.townId, town.id) : undefined,
    status ? eq(subscribers.status, status) : undefined,
    q ? ilike(subscribers.email, `%${q.replace(/[%_\\]/g, '\\$&')}%`) : undefined,
  );
  const [rows, counts] = await Promise.all([
    db().select().from(subscribers).where(where).orderBy(desc(subscribers.createdAt)).limit(200),
    town
      ? db()
          .select({ status: subscribers.status, n: sql<number>`count(*)::int` })
          .from(subscribers)
          .where(eq(subscribers.townId, town.id))
          .groupBy(subscribers.status)
      : Promise.resolve([]),
  ]);
  const count = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  return (
    <main>
      <header className={styles.pageHead}>
        <div>
          <h1>Subscribers</h1>
          <p className={styles.muted}>Newsletter readers by town, with their consent record.</p>
        </div>
        {town ? (
          <Link
            href={`/admin/mail/subscribers/export?town=${encodeURIComponent(town.slug)}`}
            className={`${styles.button} ${styles.secondary}`}
          >
            Export CSV
          </Link>
        ) : null}
      </header>
      {params.done ? (
        <p className={styles.notice} role="status">
          {params.done}
        </p>
      ) : null}
      <form className={styles.filters} method="get">
        <label>
          <span className={styles.visuallyHidden}>Town</span>
          <select name="town" defaultValue={town?.slug}>
            {allTowns.map((t) => (
              <option key={t.id} value={t.slug}>
                {t.siteName}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={styles.visuallyHidden}>Status</span>
          <select name="status" defaultValue={status ?? ''}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.search}>
          <span className={styles.visuallyHidden}>Search</span>
          <input name="q" type="search" defaultValue={q} placeholder="Search by email" />
        </label>
        <button className={`${styles.button} ${styles.secondary}`} type="submit">
          Show
        </button>
      </form>
      {town ? (
        <div className={styles.stats} data-testid="subscriber-counts">
          {STATUSES.map((st) => (
            <div key={st} className={styles.stat}>
              <div className={styles.statLabel}>
                <span className={styles.visuallyHidden}>{`${count[st] ?? 0} `}</span>
                {st}
              </div>
              <div className={styles.statValue} aria-hidden="true">
                {(count[st] ?? 0).toLocaleString('en-US')}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="subscribers">
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>Consent</th>
              <th>Confirmed</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>{s.email}</td>
                <td>
                  <Pill status={s.status} />
                </td>
                <td className={styles.muted}>
                  {s.consentSource ?? s.source ?? '–'}
                  {s.consentAt
                    ? ` · ${s.consentAt.toISOString().slice(0, 16).replace('T', ' ')}`
                    : ''}
                </td>
                <td>{s.confirmedAt ? s.confirmedAt.toISOString().slice(0, 10) : '–'}</td>
                <td>
                  {s.status === 'active' || s.status === 'pending' ? (
                    <form action={unsubscribeAction}>
                      <input type="hidden" name="subscriberId" value={s.id} />
                      <input
                        type="hidden"
                        name="filters"
                        value={new URLSearchParams({
                          town: town?.slug ?? '',
                          status: status ?? '',
                          q,
                        }).toString()}
                      />
                      <button className={`${styles.button} ${styles.secondary}`} type="submit">
                        Unsubscribe
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 200 ? (
        <p className={styles.muted}>Showing the newest 200. Search to narrow.</p>
      ) : null}
    </main>
  );
}
