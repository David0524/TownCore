import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ANALYTICS_RANGES, siteAnalytics } from '@towncore/pipeline';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import adminStyles from '../../admin.module.css';
import { checkNowAction } from '../actions';
import styles from '../analytics.module.css';
import { DailyBars, StatusLight, Tile, age, count, duration, money, pct, rangeOf } from '../parts';

export const metadata = { title: 'Site analytics' };
export const dynamic = 'force-dynamic';

const productNames: Record<string, string> = {
  enhanced: 'Enhanced listing',
  sponsored_slot: 'Featured spot',
  exclusive: 'Category sponsor',
  newsletter: 'Newsletter sponsor',
  spotlight: 'Spotlight',
};

// One site in depth (Admin → Analytics): its light and checks, daily traffic and time on page,
// top stories, where readers came from, ad slots, the newsletter and every paying advertiser.
export default async function SiteAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ days?: string; done?: string }>;
}) {
  await requireStaff();
  const { slug } = await params;
  const query = await searchParams;
  const days = rangeOf(query.days);
  const site = await siteAnalytics(db(), slug, { days });
  if (!site) notFound();
  const t = site.totals;
  const here = `/admin/analytics/${site.slug}?days=${days}`;

  return (
    <main>
      <p>
        <Link href={`/admin/analytics?days=${days}`}>← All sites</Link>
      </p>
      <h1>{site.siteName}</h1>
      <p className={styles.muted}>
        {site.domain} · {site.status} ·{' '}
        {age(site.ageDays, site.status === 'live' && site.liveAt !== null)}
        {site.liveAt ? ` (since ${site.liveAt.toISOString().slice(0, 10)})` : ''}
        {site.cohort ? ` · cohort ${site.cohort}` : ''}
      </p>
      {query.done ? (
        <p className={adminStyles.notice} role="status">
          {query.done}
        </p>
      ) : null}
      <nav className={styles.ranges} aria-label="Range">
        {ANALYTICS_RANGES.map((r) => (
          <Link
            key={r}
            href={`/admin/analytics/${site.slug}?days=${r}`}
            aria-current={r === days ? 'page' : undefined}
          >
            {r} days
          </Link>
        ))}
      </nav>

      <h2>Status</h2>
      <div className={styles.tiles} data-testid="site-status">
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Right now</div>
          <div className={styles.tileValue}>
            <StatusLight uptime={site.uptime} />
          </div>
          <div className={styles.tileNote}>{site.uptime.why}</div>
        </div>
        <Tile label="Uptime, 24 hours" value={pct(site.uptime.day)} />
        <Tile label="Uptime, 7 days" value={pct(site.uptime.week)} />
        <Tile label="Uptime, 30 days" value={pct(site.uptime.month)} />
        <Tile
          label="Last answer"
          value={site.uptime.lastMs === null ? '–' : `${count(site.uptime.lastMs)} ms`}
          note={
            site.uptime.lastCheckedAt
              ? `${site.uptime.lastCheckedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`
              : 'Never checked'
          }
        />
      </div>
      <form action={checkNowAction} className={adminStyles.actions}>
        <input type="hidden" name="townId" value={site.id} />
        <input type="hidden" name="back" value={here} />
        <button type="submit" className={adminStyles.button}>
          Check now
        </button>
      </form>

      <h2>Readers</h2>
      <div className={styles.tiles}>
        <Tile
          label="Page views"
          value={count(t.pageViews)}
          note={`${count(t.storyViews)} on stories`}
        />
        <Tile label="Avg time on page" value={duration(t.avgEngagedSeconds)} />
        <Tile label="Story clicks from lists" value={count(t.storyClicks)} />
        <Tile
          label="Ad clicks"
          value={count(t.adClicks)}
          note={`${count(t.adImpressions)} impressions · ${pct(t.adImpressions ? t.adClicks / t.adImpressions : null)} click rate`}
        />
        <Tile label="Leads" value={count(t.leads)} note="Quote requests and call taps" />
      </div>
      <div className={styles.charts}>
        <DailyBars
          title="Page views"
          points={site.daily.map((d) => ({ day: d.day, value: d.pageViews }))}
          format={count}
        />
        <DailyBars
          title="Average time on page"
          points={site.daily.map((d) => ({ day: d.day, value: d.avgEngagedSeconds }))}
          format={(n) => duration(n)}
        />
      </div>

      <div className={styles.sections}>
        <section>
          <h3>Top stories</h3>
          {site.topStories.length ? (
            <table className={adminStyles.table}>
              <thead>
                <tr>
                  <th>Story</th>
                  <th className={styles.num}>Views</th>
                  <th className={styles.num}>Avg time</th>
                  <th className={styles.num}>Clicks</th>
                </tr>
              </thead>
              <tbody>
                {site.topStories.map((s) => (
                  <tr key={s.slug}>
                    <td>{s.headline}</td>
                    <td className={styles.num}>{count(s.views)}</td>
                    <td className={styles.num}>{duration(s.avgEngagedSeconds)}</td>
                    <td className={styles.num}>{count(s.clicks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className={styles.muted}>No story views in this range.</p>
          )}
        </section>
        <section>
          <h3>Where story readers came from</h3>
          <Breakdown rows={site.referrals.map((r) => ({ label: r.source, value: r.views }))} />
          <h3>Pages</h3>
          {site.pageKinds.length ? (
            <table className={adminStyles.table}>
              <thead>
                <tr>
                  <th>Kind</th>
                  <th className={styles.num}>Views</th>
                  <th className={styles.num}>Avg time</th>
                </tr>
              </thead>
              <tbody>
                {site.pageKinds.map((k) => (
                  <tr key={k.kind}>
                    <td>{k.kind}</td>
                    <td className={styles.num}>{count(k.views)}</td>
                    <td className={styles.num}>{duration(k.avgEngagedSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className={styles.muted}>No page views in this range.</p>
          )}
        </section>
      </div>

      <h2>Newsletter</h2>
      <div className={styles.tiles}>
        <Tile label="Subscribers" value={count(site.newsletter.active)} />
        <Tile label={`New in ${days} days`} value={count(t.newSubscribers)} />
        <Tile label="Waiting to confirm" value={count(site.newsletter.pending)} />
        <Tile label="Left" value={count(site.newsletter.left)} note="Unsubscribed or bounced" />
      </div>
      <div className={styles.charts}>
        <DailyBars
          title="New subscribers"
          points={site.daily.map((d) => ({ day: d.day, value: d.newSubscribers }))}
          format={count}
        />
      </div>

      <h2>Advertisers and money</h2>
      <div className={styles.tiles}>
        <Tile
          label="Advertisers"
          value={count(t.advertisers)}
          note={`${count(t.trialing)} in free trial`}
        />
        <Tile
          label="Monthly revenue"
          value={money(t.mrrCents)}
          note="Paid subscriptions, not trials"
        />
        <Tile label={`Booked one-off, ${days} days`} value={money(t.bookedCents)} />
      </div>
      {site.advertisers.length ? (
        <div className={adminStyles.scroll}>
          <table className={adminStyles.table} data-testid="site-advertisers">
            <thead>
              <tr>
                <th>Business</th>
                <th>Product</th>
                <th>Since</th>
                <th className={styles.num}>Monthly</th>
              </tr>
            </thead>
            <tbody>
              {site.advertisers.map((a, i) => (
                <tr key={`${a.business}-${i}`}>
                  <td>{a.business}</td>
                  <td>
                    {productNames[a.product] ?? a.product}
                    {a.rank ? ` #${a.rank}` : ''}
                    {a.category ? ` · ${a.category}` : ''}
                    {a.period ? ` · ${a.period}` : ''}
                    {a.trialEndsAt && a.trialEndsAt > new Date() ? (
                      <div className={styles.muted}>
                        Free trial to {a.trialEndsAt.toISOString().slice(0, 10)}
                      </div>
                    ) : null}
                  </td>
                  <td>{a.since ? a.since.toISOString().slice(0, 10) : '–'}</td>
                  <td className={styles.num}>
                    {a.monthlyCents === null ? '–' : money(a.monthlyCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.muted}>No paying advertisers yet.</p>
      )}
      <h3>Ad slots</h3>
      {site.slots.length ? (
        <table className={adminStyles.table}>
          <thead>
            <tr>
              <th>Slot</th>
              <th className={styles.num}>Impressions</th>
              <th className={styles.num}>Clicks</th>
              <th className={styles.num}>Click rate</th>
              <th className={styles.num}>Leads</th>
            </tr>
          </thead>
          <tbody>
            {site.slots.map((s) => (
              <tr key={s.slot}>
                <td>
                  <code>{s.slot}</code>
                </td>
                <td className={styles.num}>{count(s.impressions)}</td>
                <td className={styles.num}>{count(s.clicks)}</td>
                <td className={styles.num}>
                  {pct(s.impressions ? s.clicks / s.impressions : null)}
                </td>
                <td className={styles.num}>{count(s.leads)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={styles.muted}>No ad impressions in this range.</p>
      )}

      <h2>Recent checks</h2>
      {site.uptime.recent.length ? (
        <table className={adminStyles.table} data-testid="site-checks">
          <thead>
            <tr>
              <th>When (UTC)</th>
              <th>Result</th>
              <th className={styles.num}>Time</th>
            </tr>
          </thead>
          <tbody>
            {site.uptime.recent.map((c) => (
              <tr key={c.checkedAt.toISOString()}>
                <td>{c.checkedAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
                <td>{c.ok ? 'OK' : `Failed: ${c.error ?? `HTTP ${c.statusCode}`}`}</td>
                <td className={styles.num}>{c.ms === null ? '–' : `${count(c.ms)} ms`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={styles.muted}>
          No checks yet.{' '}
          {site.status === 'live'
            ? 'The worker checks every 5 minutes; press Check now to check at once.'
            : 'Drafts are checked only at a preview address set in SITE_CHECK_URLS.'}
        </p>
      )}
    </main>
  );
}

/** A small share table: each row's count and its share of the total. */
function Breakdown({ rows }: { rows: Array<{ label: string; value: number }> }) {
  const total = rows.reduce((n, r) => n + r.value, 0);
  if (!total) return <p className={styles.muted}>No story views in this range.</p>;
  return (
    <table className={adminStyles.table}>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td>{r.label}</td>
            <td className={styles.num}>{count(r.value)}</td>
            <td className={styles.num}>{pct(r.value / total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
