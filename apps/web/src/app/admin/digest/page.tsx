import { DIGEST_SECTIONS, listDigests, type DigestItem } from '@towncore/pipeline';
import Link from 'next/link';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../admin.module.css';

export const metadata = { title: 'Digest' };
export const dynamic = 'force-dynamic';

// Admin → Digest (owner, 2026-10-17; docs/plans/agentic-ops.md): the ops agent's daily summary,
// built in code before the US Eastern morning and emailed to admins on the company domain. Every
// item has a suggested action and a link; the decisions themselves stay on their own pages.

export default async function Digest({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireStaff();
  const params = await searchParams;
  const digests = await listDigests(db(), 30);
  const shown = digests.find((d) => d.date === params.date) ?? digests[0];
  const items = (shown?.items ?? []) as DigestItem[];
  return (
    <main>
      <h1>Daily digest</h1>
      {!shown ? (
        <p>No digest yet. The worker builds one every morning (09:40 UTC).</p>
      ) : (
        <>
          <p className={styles.muted} data-testid="digest-date">
            {shown.date}
            {shown.emailedAt
              ? `, emailed ${shown.emailedAt.toISOString().slice(11, 16)} UTC`
              : ', not emailed (mail is not set up, or no admin on the company domain)'}
          </p>
          <div data-testid="digest">
            {DIGEST_SECTIONS.map((section) => {
              const list = items.filter((i) => i.section === section);
              if (!list.length) return null;
              return (
                <section key={section} aria-label={section}>
                  <h2>{section}</h2>
                  <ul>
                    {list.map((i, n) => (
                      <li key={n} data-severity={i.severity}>
                        {i.severity === 'info' ? null : (
                          <strong>{i.severity === 'critical' ? 'Critical: ' : 'Warning: '}</strong>
                        )}
                        {i.text}{' '}
                        <span className={styles.muted}>
                          Next: {i.action} <Link href={i.link}>Open</Link>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
      {digests.length > 1 ? (
        <>
          <h2>Earlier</h2>
          <ul>
            {digests.map((d) => (
              <li key={d.id}>
                <Link href={`/admin/digest?date=${d.date}`}>{d.date}</Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </main>
  );
}
