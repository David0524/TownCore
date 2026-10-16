import { businesses, desc, eq, inArray, photoSubmissions, towns } from '@towncore/db';
import { pendingPhotos } from '@towncore/photos';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../admin.module.css';
import { decide } from './actions';

export const metadata = { title: 'Photos' };

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

// Reader and business photos waiting for review (M9, CLAUDE.md §11c). Nothing shows on a site
// until it's approved here with alt text written from what the photo shows.
export default async function PhotosPage({ searchParams }: Props) {
  await requireStaff();
  const { done, error } = await searchParams;
  const pending = await pendingPhotos(db());
  const listingIds = pending.map((p) => p.photo.businessId).filter((id): id is string => !!id);
  const listings = listingIds.length
    ? await db()
        .select({ id: businesses.id, name: businesses.name })
        .from(businesses)
        .where(inArray(businesses.id, listingIds))
    : [];
  const listingName = new Map(listings.map((l) => [l.id, l.name]));
  const decided = await db()
    .select({ photo: photoSubmissions, siteName: towns.siteName })
    .from(photoSubmissions)
    .innerJoin(towns, eq(photoSubmissions.townId, towns.id))
    .where(inArray(photoSubmissions.status, ['approved', 'rejected']))
    .orderBy(desc(photoSubmissions.reviewedAt))
    .limit(20);

  return (
    <main>
      <h1>Photos</h1>
      {done ? (
        <p className={styles.notice} role="status">
          Photo {done}.
        </p>
      ) : null}
      {error ? (
        <p className={styles.notice} role="alert">
          {error}
        </p>
      ) : null}
      <p>
        Approve only photos the sender plausibly took, of this town, with no identifiable child, no
        home address, and nothing that reads as a crime or accident scene. Write alt text from what
        the photo actually shows.
      </p>
      <h2>Waiting ({pending.length})</h2>
      {pending.length === 0 ? <p>No photos are waiting.</p> : null}
      {pending.map(({ photo, siteName }) => (
        <section
          key={photo.id}
          className={styles.panel}
          data-testid="pending-photo"
          style={{ marginBottom: '1.5rem' }}
        >
          <img
            src={`/admin/photos/${photo.id}`}
            alt=""
            width={photo.width}
            height={photo.height}
            style={{ maxWidth: '100%', height: 'auto', maxHeight: '28rem', objectFit: 'contain' }}
          />
          <dl>
            <dt>Site</dt>
            <dd>
              {siteName} ·{' '}
              {photo.kind === 'business'
                ? `Business photo for ${listingName.get(photo.businessId!) ?? 'a listing'}`
                : 'Reader photo'}
            </dd>
            <dt>Caption</dt>
            <dd>{photo.caption}</dd>
            {photo.takenWhere || photo.takenWhen ? (
              <>
                <dt>Where and when</dt>
                <dd>{[photo.takenWhere, photo.takenWhen].filter(Boolean).join(' · ')}</dd>
              </>
            ) : null}
            <dt>Credit</dt>
            <dd>{photo.credit}</dd>
            <dt>From</dt>
            <dd>
              {photo.submitterName} &lt;{photo.submitterEmail}&gt;, {photo.width}×{photo.height},
              license {photo.licenseVersion}
            </dd>
          </dl>
          <form action={decide} className={styles.form}>
            <input type="hidden" name="id" value={photo.id} />
            <label htmlFor={`alt-${photo.id}`}>Alt text (what the photo shows)</label>
            <textarea id={`alt-${photo.id}`} name="alt" rows={2} maxLength={300} />
            <label htmlFor={`reason-${photo.id}`}>Reason, if rejecting (internal)</label>
            <input id={`reason-${photo.id}`} name="reason" maxLength={300} />
            <div className={styles.actions}>
              <button type="submit" name="decision" value="approve" className={styles.button}>
                Approve
              </button>
              <button
                type="submit"
                name="decision"
                value="reject"
                className={`${styles.button} ${styles.secondary}`}
              >
                Reject
              </button>
            </div>
          </form>
        </section>
      ))}
      <h2>Recently decided</h2>
      {decided.length === 0 ? (
        <p>None yet.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Site</th>
              <th>Kind</th>
              <th>Caption</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {decided.map(({ photo, siteName }) => (
              <tr key={photo.id}>
                <td>{siteName}</td>
                <td>{photo.kind}</td>
                <td>{photo.caption}</td>
                <td>
                  {photo.status === 'approved'
                    ? `Approved: ${photo.alt}`
                    : `Rejected${photo.rejectReason ? `: ${photo.rejectReason}` : ''}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
