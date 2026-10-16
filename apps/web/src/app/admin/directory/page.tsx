import { eq, towns } from '@towncore/db';
import {
  listClaims,
  listPlacements,
  pendingNameChanges,
  pendingSponsorCards,
} from '@towncore/directory';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import { listingPath } from '@/lib/directory';
import styles from '../admin.module.css';
import { decideCardAction, decideClaimAction, decideNameAction } from './actions';

export const metadata = { title: 'Directory' };

const when = (d: Date | null) =>
  d ? d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '–';
const publicUrl = (domain: string, path: string) => `https://${domain}${path}`;

// Admin → Directory (M6 PR C): claims waiting for a decision, owners' new names, and the latest
// decisions. Check the claimant against the license (name, role, email domain) before approving.
export default async function DirectoryAdmin({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  await requireStaff();
  const { done, error } = await searchParams;
  const [waiting, decided, names, paid] = await Promise.all([
    listClaims(db(), { statuses: ['pending'] }),
    listClaims(db(), { statuses: ['approved', 'rejected'], limit: 20 }),
    pendingNameChanges(db()),
    listPlacements(db()),
  ]);
  const cards = await pendingSponsorCards(db());
  const townRows = names.length
    ? await Promise.all(
        [...new Set(names.map((n) => n.townId))].map(
          async (id) => (await db().select().from(towns).where(eq(towns.id, id)))[0]!,
        ),
      )
    : [];
  const domainOf = new Map(townRows.map((t) => [t.id, t.domain]));

  return (
    <main>
      <h1>Directory</h1>
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

      <h2>Claims waiting for a decision ({waiting.length})</h2>
      <p className={styles.muted}>
        The claimant has confirmed their email address. Approve only when the person, their role and
        their email fit the licensed business. Approving makes them the listing&apos;s one owner and
        emails them a sign-in link.
      </p>
      {waiting.length === 0 ? <p>No claims are waiting.</p> : null}
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="claims-waiting">
          <tbody>
            {waiting.map((claim) => (
              <tr key={claim.id}>
                <td>
                  <a
                    href={publicUrl(claim.town.domain, listingPath(claim.business))}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {claim.business.name}
                  </a>
                  <div className={styles.muted}>
                    {claim.town.name} · {claim.business.licenseType} {claim.business.licenseNumber}
                  </div>
                  {claim.business.claimedByEmail ? (
                    <div className={styles.bad}>
                      Already managed by {claim.business.claimedByEmail}
                    </div>
                  ) : null}
                </td>
                <td>
                  {claim.claimantName}, {claim.claimantRole}
                  <div className={styles.muted}>{claim.email}</div>
                  <div className={styles.muted}>Verified {when(claim.verifiedAt)}</div>
                </td>
                <td>
                  <form action={decideClaimAction} className={styles.actions}>
                    <input type="hidden" name="claimId" value={claim.id} />
                    <input name="note" placeholder="Note (optional)" aria-label="Note" />
                    <button type="submit" name="decision" value="approve" className={styles.button}>
                      Approve
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>New business names ({names.length})</h2>
      {names.length === 0 ? <p>No name changes are waiting.</p> : null}
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="names-waiting">
          <tbody>
            {names.map((listing) => (
              <tr key={listing.id}>
                <td>
                  <a
                    href={publicUrl(domainOf.get(listing.townId) ?? '', listingPath(listing))}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {listing.name}
                  </a>{' '}
                  → <strong>{listing.pendingName}</strong>
                  <div className={styles.muted}>
                    License {listing.licenseNumber} · owner {listing.claimedByEmail}
                  </div>
                </td>
                <td>
                  <form action={decideNameAction} className={styles.actions}>
                    <input type="hidden" name="businessId" value={listing.id} />
                    <button type="submit" name="decision" value="approve" className={styles.button}>
                      Approve name
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Sponsor cards waiting ({cards.length})</h2>
      <p className={styles.muted}>
        Check the text is accurate, about the business itself, and makes no claims we can&apos;t
        stand behind. The &quot;Sponsored&quot; label is added by the site.
      </p>
      {cards.length === 0 ? <p>No cards are waiting.</p> : null}
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="cards-waiting">
          <tbody>
            {cards.map((c) => (
              <tr key={c.campaignId}>
                <td>
                  <strong>{c.headline}</strong>
                  {c.body ? <div>{c.body}</div> : null}
                  <div className={styles.muted}>
                    {c.business.name} · {c.business.category} · {c.town.name}
                  </div>
                </td>
                <td>
                  <form action={decideCardAction} className={styles.actions}>
                    <input type="hidden" name="campaignId" value={c.campaignId} />
                    <input name="note" placeholder="Reason if rejecting" aria-label="Note" />
                    <button type="submit" name="decision" value="approve" className={styles.button}>
                      Approve card
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Paid placements</h2>
      <p className={styles.muted}>
        Stripe test mode (D-M6-5). A held placement was paid after its category filled up: it is
        never shown. Refund it in the Stripe dashboard or move it to the next opening.
      </p>
      {paid.length === 0 ? <p>No placements yet.</p> : null}
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="placements">
          <thead>
            <tr>
              <th>Listing</th>
              <th>Product</th>
              <th>Status</th>
              <th>Buyer</th>
            </tr>
          </thead>
          <tbody>
            {paid.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.business.name}
                  <div className={styles.muted}>{p.townName}</div>
                </td>
                <td>
                  {p.product}
                  {p.category ? <div className={styles.muted}>{p.category}</div> : null}
                </td>
                <td className={p.status === 'held' ? styles.bad : undefined}>
                  {p.status}
                  {p.endsAt ? <div className={styles.muted}>ends {when(p.endsAt)}</div> : null}
                  {p.stripeSubscriptionId ? (
                    <div className={styles.muted}>{p.stripeSubscriptionId}</div>
                  ) : null}
                </td>
                <td>{p.buyerEmail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Recent decisions</h2>
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="claims-decided">
          <thead>
            <tr>
              <th>Listing</th>
              <th>Claimant</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {decided.map((claim) => (
              <tr key={claim.id}>
                <td>
                  {claim.business.name}
                  <div className={styles.muted}>{claim.town.name}</div>
                </td>
                <td>
                  {claim.claimantName}
                  <div className={styles.muted}>{claim.email}</div>
                </td>
                <td>
                  {claim.status} {when(claim.decidedAt)}
                  {claim.decisionNote ? (
                    <div className={styles.muted}>{claim.decisionNote}</div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
