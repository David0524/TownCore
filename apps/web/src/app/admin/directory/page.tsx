import { eq, towns } from '@towncore/db';
import {
  followupApprovals,
  listClaims,
  listPlacements,
  pendingBusinessRequests,
  pendingNameChanges,
  pendingFollowups,
  pendingOutreach,
  pendingSponsorCards,
  pendingTestimonials,
} from '@towncore/directory';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import { listingPath } from '@/lib/directory';
import styles from '../admin.module.css';
import {
  decideCardAction,
  decideClaimAction,
  decideNameAction,
  decideRequestAction,
  decideTestimonialAction,
  followupAction,
  followupApprovalAction,
  sendOutreachAction,
} from './actions';

export const metadata = { title: 'Directory' };

const when = (d: Date | null) =>
  d ? d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '–';
const publicUrl = (domain: string, path: string) => `https://${domain}${path}`;

// Admin → Directory (M6 PR C): claims waiting for a decision, owners' new names, and the latest
// decisions. Check the claimant against the license (name, role, email domain) before approving.
export default async function DirectoryAdmin({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string; confirm?: string }>;
}) {
  const me = await requireStaff();
  const { done, error, confirm } = await searchParams;
  const [waiting, decided, names, paid] = await Promise.all([
    listClaims(db(), { statuses: ['pending'] }),
    listClaims(db(), { statuses: ['approved', 'rejected'], limit: 20 }),
    pendingNameChanges(db()),
    listPlacements(db()),
  ]);
  const [cards, outreach, requests, followups, approvals, quotes] = await Promise.all([
    pendingSponsorCards(db()),
    pendingOutreach(db()),
    pendingBusinessRequests(db()),
    pendingFollowups(db()),
    followupApprovals(db()),
    pendingTestimonials(db()),
  ]);
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
      <p>
        <a href="/admin/directory/pricing">Pricing</a>: current category prices, proposals waiting
        for an admin, overrides, waitlists and revenue by category.
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

      <h2>Businesses asking to be added ({requests.length})</h2>
      <p className={styles.muted}>
        Sent from &ldquo;Add your business&rdquo;. Check that the business is real and in the town
        (its website, a license, the map) and isn&apos;t listed already. Adding lists it with these
        details shown; the sender can then claim it. Nothing is emailed.
      </p>
      {requests.length === 0 ? <p>No requests are waiting.</p> : null}
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="requests-waiting">
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.name}</strong>
                  <div className={styles.muted}>
                    {r.town.name} · {r.category}
                  </div>
                  <div className={styles.muted}>
                    {[r.address, r.zip, r.phone].filter(Boolean).join(' · ') || 'No address'}
                  </div>
                  {r.website ? (
                    <a href={r.website} target="_blank" rel="noreferrer nofollow">
                      {r.website}
                    </a>
                  ) : null}
                  {r.note ? <div className={styles.muted}>&ldquo;{r.note}&rdquo;</div> : null}
                </td>
                <td>
                  {r.contactName}
                  <div className={styles.muted}>{r.email}</div>
                  <div className={styles.muted}>Sent {when(r.createdAt)}</div>
                </td>
                <td>
                  <form action={decideRequestAction} className={styles.actions}>
                    <input type="hidden" name="requestId" value={r.id} />
                    <button type="submit" name="decision" value="add" className={styles.button}>
                      Add to Places
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

      <h2 id="outreach">Outreach drafts ({outreach.length})</h2>
      <p className={styles.muted}>
        Drafted when a published story names a listed business (§11). Nothing is sent until you
        press Send; replies come back to the inbox from sales@. For an unclaimed listing, add an
        address from the business&apos;s own website, or dismiss the draft. Never guess one.
      </p>
      {outreach.length === 0 ? <p>No drafts are waiting.</p> : null}
      <div data-testid="outreach-drafts">
        {outreach.map((d) => (
          <form key={d.id} action={sendOutreachAction} className={styles.form}>
            <input type="hidden" name="draftId" value={d.id} />
            <p>
              <a
                href={publicUrl(
                  d.town.domain,
                  listingPath({ category: d.business.category ?? '', slug: d.business.slug }),
                )}
                target="_blank"
                rel="noreferrer"
              >
                {d.business.name}
              </a>{' '}
              · {d.town.name} · {d.business.claimed ? 'claimed' : 'unclaimed'} · in{' '}
              <a
                href={publicUrl(d.town.domain, `/news/${d.article.slug}`)}
                target="_blank"
                rel="noreferrer"
              >
                {d.article.headline}
              </a>
            </p>
            <label htmlFor={`to-${d.id}`}>To</label>
            <input
              id={`to-${d.id}`}
              name="to"
              type="email"
              defaultValue={d.toEmail ?? ''}
              placeholder="Address from the business’s own website"
            />
            <label htmlFor={`subject-${d.id}`}>Subject</label>
            <input id={`subject-${d.id}`} name="subject" defaultValue={d.subject} />
            <label htmlFor={`body-${d.id}`}>Message</label>
            <textarea id={`body-${d.id}`} name="body" rows={10} defaultValue={d.body} />
            {confirm === d.id ? (
              <label>
                <input type="checkbox" name="confirmSuppressed" /> Send anyway to the suppressed
                address
              </label>
            ) : null}
            <div className={styles.actions}>
              <button type="submit" name="decision" value="send" className={styles.button}>
                Send
              </button>
              <button type="submit" name="decision" value="dismiss" className={styles.secondary}>
                Dismiss
              </button>
            </div>
          </form>
        ))}
      </div>

      <h2 id="followups">Owner follow-ups ({followups.length})</h2>
      <p className={styles.muted}>
        Short emails to claimed owners: a free trial ending in 3 days, a competitor taking a
        featured spot in their category, a story naming the business, another business nearby in
        their category claiming its listing. At most one a week per business besides the trial
        reminder, each with a one-click unsubscribe, never to a suppressed address. They send by
        themselves only in towns where an admin has turned on the standing approval below (Rule 10);
        everywhere else they wait here until you press Send.
      </p>
      <table className={styles.table} data-testid="followup-approvals">
        <thead>
          <tr>
            <th>Town</th>
            <th>Automatic follow-ups</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {approvals.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td>{t.approvedAt ? `On since ${when(t.approvedAt)}` : 'Off: staff press Send'}</td>
              <td>
                {me.role === 'admin' ? (
                  <form action={followupApprovalAction}>
                    <input type="hidden" name="townId" value={t.id} />
                    <input type="hidden" name="on" value={t.approvedAt ? 'no' : 'yes'} />
                    <button
                      type="submit"
                      className={t.approvedAt ? styles.secondary : styles.button}
                      aria-label={`${t.approvedAt ? 'Turn off' : 'Turn on'} automatic follow-ups in ${t.name}`}
                    >
                      {t.approvedAt ? 'Turn off' : 'Turn on'}
                    </button>
                  </form>
                ) : (
                  <span className={styles.muted}>Admins only</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {followups.length === 0 ? <p>No follow-ups are waiting.</p> : null}
      <div data-testid="followup-drafts">
        {followups.map((f) => (
          <form key={f.id} action={followupAction} className={styles.form}>
            <input type="hidden" name="followupId" value={f.id} />
            <p>
              <strong>{f.subject}</strong> · {f.town.name} · {f.business.name} · to {f.toEmail}
            </p>
            {f.lines.map((line, i) => (
              <p key={i} className={styles.muted}>
                {line}
              </p>
            ))}
            <p className={styles.muted}>
              {f.link.label}: {f.link.href}
            </p>
            <div className={styles.actions}>
              <button type="submit" name="decision" value="send" className={styles.button}>
                Send
              </button>
              <button type="submit" name="decision" value="skip" className={styles.secondary}>
                Skip
              </button>
            </div>
          </form>
        ))}
      </div>

      <h2>Testimonials waiting ({quotes.length})</h2>
      <p className={styles.muted}>
        Written by owners who have advertised, with their permission to show it on the advertise
        page, credited to the business. Approve or reject as written; never edit the words.
      </p>
      {quotes.length === 0 ? <p>No testimonials are waiting.</p> : null}
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="testimonials-waiting">
          <tbody>
            {quotes.map((q) => (
              <tr key={q.id}>
                <td>
                  &ldquo;{q.quote}&rdquo;
                  <div className={styles.muted}>
                    {q.attribution} · {q.townName} · {q.email}
                  </div>
                </td>
                <td>
                  <form action={decideTestimonialAction} className={styles.actions}>
                    <input type="hidden" name="testimonialId" value={q.id} />
                    <button type="submit" name="decision" value="approve" className={styles.button}>
                      Approve testimonial
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
