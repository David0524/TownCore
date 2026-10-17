import Link from 'next/link';
import { ANALYTICS_RANGES, networkAnalytics } from '@towncore/pipeline';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import adminStyles from '../admin.module.css';
import { checkNowAction } from './actions';
import styles from './analytics.module.css';
import { StatusLight, Tile, age, count, duration, money, pct, rangeOf } from './parts';

export const metadata = { title: 'Analytics' };
export const dynamic = 'force-dynamic';

// Admin → Analytics (owner, 2026-10-17): every site's age and up/down light first, then what
// readers did (views, time on page, clicks), the newsletter, advertisers and money. Counters are
// cookieless aggregates (D-M4-3); the light comes from the uptime checks.
export default async function Analytics({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; done?: string }>;
}) {
  await requireStaff();
  const params = await searchParams;
  const days = rangeOf(params.days);
  const { sites, totals } = await networkAnalytics(db(), { days });
  const live = sites.filter((s) => s.status === 'live');
  const down = sites.filter((s) => s.uptime.light === 'down');
  const checked = sites.filter((s) => s.uptime.light !== 'unknown');

  return (
    <main>
      <h1>Analytics</h1>
      {params.done ? (
        <p className={adminStyles.notice} role="status">
          {params.done}
        </p>
      ) : null}
      <nav className={styles.ranges} aria-label="Range">
        {ANALYTICS_RANGES.map((r) => (
          <Link
            key={r}
            href={`/admin/analytics?days=${r}`}
            aria-current={r === days ? 'page' : undefined}
          >
            {r} days
          </Link>
        ))}
        <form action={checkNowAction}>
          <input type="hidden" name="back" value={`/admin/analytics?days=${days}`} />
          <button type="submit" className={adminStyles.button}>
            Check every site now
          </button>
        </form>
      </nav>

      <div className={styles.tiles} data-testid="analytics-tiles">
        <Tile
          label="Sites"
          value={count(sites.length)}
          note={`${live.length} live · ${sites.length - live.length} draft or paused`}
        />
        <Tile
          label="Up right now"
          value={checked.length ? `${checked.length - down.length} of ${checked.length}` : '–'}
          note={
            down.length
              ? `Down: ${down.map((s) => s.siteName).join(', ')}`
              : checked.length
                ? 'None down'
                : 'No checks yet'
          }
        />
        <Tile label={`Page views, ${days} days`} value={count(totals.pageViews)} />
        <Tile label="Avg time on page" value={duration(totals.avgEngagedSeconds)} />
        <Tile
          label="Clicks"
          value={count(totals.storyClicks + totals.adClicks)}
          note={`${count(totals.storyClicks)} on stories · ${count(totals.adClicks)} on ads`}
        />
        <Tile
          label="Newsletter subscribers"
          value={count(totals.subscribers)}
          note={`+${count(totals.newSubscribers)} in ${days} days`}
        />
        <Tile
          label="Advertisers"
          value={count(totals.advertisers)}
          note={`${count(totals.trialing)} in free trial`}
        />
        <Tile
          label="Monthly revenue"
          value={money(totals.mrrCents)}
          note={`${money(totals.bookedCents)} booked one-off · ${count(totals.leads)} leads`}
        />
      </div>

      <h2>Sites</h2>
      <p className={styles.muted}>
        The light comes from a health check of each site every 5 minutes (Up, Slow over 3 seconds,
        Down after two failed checks in a row). Live sites are checked at their own domain; a draft
        is checked only at a preview address set in <code>SITE_CHECK_URLS</code>. Hover a light for
        the reason.
      </p>
      <div className={adminStyles.scroll}>
        <table className={adminStyles.table} data-testid="analytics-sites">
          <thead>
            <tr>
              <th>Status</th>
              <th>Site</th>
              <th>Age</th>
              <th className={styles.num}>Uptime 7d</th>
              <th className={styles.num}>Page views</th>
              <th className={styles.num}>Avg time</th>
              <th className={styles.num}>Clicks</th>
              <th className={styles.num}>Subscribers</th>
              <th className={styles.num}>Advertisers</th>
              <th className={styles.num}>Monthly revenue</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.id} data-site={s.slug}>
                <td>
                  <StatusLight uptime={s.uptime} />
                </td>
                <td>
                  <Link href={`/admin/analytics/${s.slug}?days=${days}`}>{s.siteName}</Link>
                  <div className={styles.muted}>
                    {s.domain} · {s.status}
                    {s.cohort ? ` · cohort ${s.cohort}` : ''}
                  </div>
                </td>
                <td>{age(s.ageDays, s.status === 'live' && s.liveAt !== null)}</td>
                <td className={styles.num}>{pct(s.uptime.week)}</td>
                <td className={styles.num}>{count(s.totals.pageViews)}</td>
                <td className={styles.num}>{duration(s.totals.avgEngagedSeconds)}</td>
                <td className={styles.num}>{count(s.totals.storyClicks + s.totals.adClicks)}</td>
                <td className={styles.num}>
                  {count(s.totals.subscribers)}
                  {s.totals.newSubscribers ? (
                    <div className={styles.muted}>+{count(s.totals.newSubscribers)}</div>
                  ) : null}
                </td>
                <td className={styles.num}>{count(s.totals.advertisers)}</td>
                <td className={styles.num}>{money(s.totals.mrrCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
