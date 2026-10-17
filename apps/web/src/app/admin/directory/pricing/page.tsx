import {
  directoryCategories,
  directoryCategory,
  PRICING_RULES,
  TIER_PRICES,
} from '@towncore/config';
import { asc, towns } from '@towncore/db';
import {
  categoryRevenue,
  priceHistory,
  townPriceBoard,
  type PriceChangeRow,
} from '@towncore/directory';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../../admin.module.css';
import { decidePriceAction, overridePriceAction } from '../actions';

export const metadata = { title: 'Directory pricing' };

const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US')}`;
const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n * 100)}%`);
const offerLabel = (product: string, rank: number | null) =>
  product === 'sponsored_slot' ? `Featured #${rank}` : 'Category sponsor';
const when = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '–');

function Inputs({ change }: { change: PriceChangeRow }) {
  const i = change.inputs as Record<string, number>;
  if (change.kind === 'override') return <>Set by hand</>;
  return (
    <>
      fill {pct(i.fillRate ?? null)} · waitlist {i.waitlist ?? 0} · value {i.valuePerSpotMonth ?? 0}
      /spot-month · checkouts {i.checkoutStarts ?? 0} · claims {i.claims ?? 0} · views{' '}
      {i.exposure ?? 0}
    </>
  );
}

// Admin → Directory → Pricing (owner, 2026-10-17): every category price is one price for every
// business in that town and category. The monthly recalculation moves prices inside the
// guardrails; bigger increases wait here for an admin. Existing subscriptions keep their price.
export default async function PricingAdmin({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string; town?: string }>;
}) {
  const me = await requireStaff();
  const { done, error, town: townParam } = await searchParams;
  const all = await db().select().from(towns).orderBy(asc(towns.name));
  const town = all.find((t) => t.id === townParam) ?? all[0];
  const [proposals, history, revenue, board] = await Promise.all([
    priceHistory(db(), { statuses: ['proposed'], limit: 100 }),
    priceHistory(db(), { statuses: ['applied', 'approved', 'rejected', 'expired'], limit: 50 }),
    categoryRevenue(db()),
    town ? townPriceBoard(db(), town.id) : null,
  ]);
  const townName = new Map(all.map((t) => [t.id, t.name]));
  const admin = me.role === 'admin';

  return (
    <main>
      <h1>Directory pricing</h1>
      <p>
        <a href="/admin/directory">Directory</a> › Pricing
      </p>
      {done ? (
        <p className={styles.notice} role="status">
          {done}
        </p>
      ) : null}
      {error ? (
        <p className={styles.notice} role="alert">
          {error}
        </p>
      ) : null}
      <p className={styles.muted}>
        Once a month each category&rsquo;s price moves by at most {PRICING_RULES.maxStep * 100}%: up
        10% when its spots sold at least 90% of the time (5% from two thirds), up 5% per business on
        the waitlist (at most 10%), and only when the spots delivered at least{' '}
        {PRICING_RULES.minValue} click, call or quote request a month; down 10% when under a third
        sold with no waitlist, no checkouts and at least {PRICING_RULES.minExposure} listing views
        (20% when nothing sold). Never below the list price less{' '}
        {Math.round((1 - PRICING_RULES.floorFactor) * 100)}%. Increases over{' '}
        {PRICING_RULES.approvalStep * 100}%, or above {PRICING_RULES.ceilingFactor}× the list price,
        wait below. Tier list prices: small{' '}
        {TIER_PRICES.small.featured_usd.map((d) => `$${d}`).join('/')}, mid{' '}
        {TIER_PRICES.mid.featured_usd.map((d) => `$${d}`).join('/')}, large{' '}
        {TIER_PRICES.large.featured_usd.map((d) => `$${d}`).join('/')}.
      </p>

      <h2>Waiting for an admin ({proposals.length})</h2>
      {proposals.length === 0 ? <p>No proposals are waiting.</p> : null}
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="price-proposals">
          <tbody>
            {proposals.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.townName} · {directoryCategory(p.category)?.name ?? p.category} ·{' '}
                  {offerLabel(p.product, p.rank)}
                  <div className={styles.muted}>
                    {usd(p.oldCents)} → {usd(p.newCents)} · {p.reason}
                  </div>
                  <div className={styles.muted}>
                    <Inputs change={p} />
                  </div>
                </td>
                <td>
                  {admin ? (
                    <form action={decidePriceAction} className={styles.actions}>
                      <input type="hidden" name="changeId" value={p.id} />
                      <button
                        type="submit"
                        name="decision"
                        value="approve"
                        className={styles.button}
                      >
                        Approve price
                      </button>
                      <button
                        type="submit"
                        name="decision"
                        value="reject"
                        className={styles.secondary}
                      >
                        Reject
                      </button>
                    </form>
                  ) : (
                    <span className={styles.muted}>An admin decides.</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Revenue by category</h2>
      <p className={styles.muted}>
        Featured spots: sold share of the last 60 days, the waitlist, trials started in 30 days,
        trial to paid, churn over 30 days (ended against running at the start) and monthly revenue
        from paid spots.
      </p>
      {revenue.length === 0 ? <p>No featured spots sold yet.</p> : null}
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="category-revenue">
          <thead>
            <tr>
              <th>Town and category</th>
              <th>Sold</th>
              <th>Waitlist</th>
              <th>Trials</th>
              <th>Trial to paid</th>
              <th>Churn</th>
              <th>Revenue a month</th>
            </tr>
          </thead>
          <tbody>
            {revenue.map((r) => (
              <tr key={`${r.townId}:${r.category}`}>
                <td>
                  {townName.get(r.townId)} · {directoryCategory(r.category)?.name ?? r.category}
                </td>
                <td>{pct(r.fillRate)}</td>
                <td>{r.waitlist}</td>
                <td>{r.trialStarts}</td>
                <td>{r.trialsEnded ? pct(r.trialsConverted / r.trialsEnded) : '–'}</td>
                <td>{r.activeAtStart ? pct(r.churned / r.activeAtStart) : '–'}</td>
                <td>{usd(r.mrrCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Current prices</h2>
      <form method="get" className={styles.actions}>
        <label>
          Town{' '}
          <select name="town" defaultValue={town?.id}>
            {all.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.tier})
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={styles.secondary}>
          Show
        </button>
      </form>
      {board && town ? (
        <>
          <div className={styles.scroll}>
            <table className={styles.table} data-testid="price-board">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Offer</th>
                  <th>Price</th>
                  <th>List</th>
                  <th>Set by</th>
                </tr>
              </thead>
              <tbody>
                {[...board.list, ...board.categories].map((row) => (
                  <tr key={`${row.category}:${row.product}:${row.rank}`}>
                    <td>{row.categoryName}</td>
                    <td>{offerLabel(row.product, row.rank)}</td>
                    <td>{usd(row.currentCents)}</td>
                    <td>{usd(row.listCents)}</td>
                    <td>
                      {row.setBy}
                      {row.updatedAt ? (
                        <div className={styles.muted}>{when(row.updatedAt)}</div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {admin ? (
            <form
              action={overridePriceAction}
              className={styles.actions}
              data-testid="price-override"
            >
              <input type="hidden" name="townId" value={town.id} />
              <label>
                Category{' '}
                <select name="category" required>
                  {directoryCategories.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Offer{' '}
                <select name="offer">
                  <option value="sponsored_slot:1">Featured #1</option>
                  <option value="sponsored_slot:2">Featured #2</option>
                  <option value="sponsored_slot:3">Featured #3</option>
                  <option value="exclusive">Category sponsor</option>
                </select>
              </label>
              <label>
                Dollars a month <input name="dollars" type="number" min={1} step={1} required />
              </label>
              <label>
                Why <input name="reason" required maxLength={300} />
              </label>
              <button type="submit" className={styles.button}>
                Set price for new bookings
              </button>
            </form>
          ) : null}
        </>
      ) : null}

      <h2>History</h2>
      <p className={styles.muted}>
        After an increase: the category&rsquo;s cancellations in the 60 days after (against the 60
        days before), and owners in the town who unsubscribed or complained in the 30 days after.
      </p>
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="price-history">
          <thead>
            <tr>
              <th>When</th>
              <th>Change</th>
              <th>Why</th>
              <th>Since</th>
            </tr>
          </thead>
          <tbody>
            {history.map((c) => (
              <tr key={c.id}>
                <td>
                  {when(c.createdAt)}
                  <div className={styles.muted}>
                    {c.kind} · {c.status}
                  </div>
                </td>
                <td>
                  {c.townName} · {directoryCategory(c.category)?.name ?? c.category} ·{' '}
                  {offerLabel(c.product, c.rank)}
                  <div className={styles.muted}>
                    {usd(c.oldCents)} → {usd(c.newCents)}
                  </div>
                </td>
                <td>
                  {c.reason}
                  <div className={styles.muted}>
                    <Inputs change={c} />
                  </div>
                </td>
                <td
                  className={
                    c.after && c.after.cancellations > c.after.cancellationsBefore
                      ? styles.bad
                      : undefined
                  }
                >
                  {c.after
                    ? `${c.after.cancellations} canceled (${c.after.cancellationsBefore} before) · ${c.after.optOuts} unsubscribed · ${c.after.complaints} complaints`
                    : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
