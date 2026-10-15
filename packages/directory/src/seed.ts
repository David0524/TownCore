import { and, businesses, eq, inArray, records, sql, type Db } from '@towncore/db';
import { listingFromRecord, type ListingDraft } from './listings';
import { listingSlug } from './names';

// Seeds a town's directory from its state license records (M6 PR A, D-M6-1). Idempotent: run
// it after every DBPR ingest. One listing per license number; a listing whose license lapses
// is marked inactive (hidden), never deleted, so claims and payments keep their history.

export const DBPR = 'fl-dbpr';

export type SeedResult = {
  created: number;
  updated: number;
  /** Listings that are listed (active) after this run. */
  active: number;
  /** Listings hidden because their license lapsed or disappeared. */
  inactive: number;
  skipped: Record<string, number>;
};

type Draft = ListingDraft & { recordId: string };

/** Several rows can share a license (qualifier, officer); keep one, preferring an active row with a DBA. */
function better(a: Draft, b: Draft): Draft {
  if (a.active !== b.active) return a.active ? a : b;
  if (a.hasDba !== b.hasDba) return a.hasDba ? a : b;
  return a;
}

export async function seedDirectory(db: Db, townId: string, now = new Date()): Promise<SeedResult> {
  const rows = await db
    .select({ id: records.id, type: records.type, raw: records.raw })
    .from(records)
    .where(and(eq(records.townId, townId), inArray(records.type, ['license', 'food_license'])));

  const skipped: Record<string, number> = {};
  const drafts = new Map<string, Draft>();
  for (const row of rows) {
    const listing = listingFromRecord(row, now);
    if ('skip' in listing) {
      skipped[listing.skip] = (skipped[listing.skip] ?? 0) + 1;
      continue;
    }
    const draft = { ...listing, recordId: row.id };
    const seen = drafts.get(draft.licenseNumber);
    drafts.set(draft.licenseNumber, seen ? better(seen, draft) : draft);
  }

  let created = 0;
  let updated = 0;
  const all = [...drafts.values()];
  for (let i = 0; i < all.length; i += 500) {
    const chunk = all.slice(i, i + 500);
    const result = await db
      .insert(businesses)
      .values(
        chunk.map((d) => ({
          townId,
          slug: listingSlug(d.name, d.licenseNumber),
          name: d.name,
          category: d.category,
          address: d.address,
          city: d.city,
          zip: d.zip,
          licenseType: d.licenseType,
          licenseNumber: d.licenseNumber,
          licenseVerified: true,
          licenseExpiresAt: d.expiresAt,
          dataSource: DBPR,
          sourceRecordId: d.recordId,
          active: d.active,
        })),
      )
      .onConflictDoUpdate({
        target: [businesses.townId, businesses.dataSource, businesses.licenseNumber],
        set: {
          category: sql`excluded.category`,
          licenseType: sql`excluded.license_type`,
          licenseVerified: sql`true`,
          licenseExpiresAt: sql`excluded.license_expires_at`,
          sourceRecordId: sql`excluded.source_record_id`,
          active: sql`excluded.active`,
          // Owners edit their own name and address once claimed (name changes are staff-reviewed).
          name: sql`case when ${businesses.claimedAt} is null then excluded.name else ${businesses.name} end`,
          address: sql`case when ${businesses.claimedAt} is null then excluded.address else ${businesses.address} end`,
          city: sql`case when ${businesses.claimedAt} is null then excluded.city else ${businesses.city} end`,
          zip: sql`case when ${businesses.claimedAt} is null then excluded.zip else ${businesses.zip} end`,
          // A new address needs geocoding again.
          geocodedAt: sql`case when ${businesses.claimedAt} is null and ${businesses.address} is distinct from excluded.address then null else ${businesses.geocodedAt} end`,
          updatedAt: now,
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    for (const row of result) {
      if (row.inserted) created++;
      else updated++;
    }
  }

  // Licenses no longer in any record (rare: records are kept) are hidden too.
  const seen = [...drafts.keys()];
  const stale = await db
    .select({ id: businesses.id, licenseNumber: businesses.licenseNumber })
    .from(businesses)
    .where(
      and(
        eq(businesses.townId, townId),
        eq(businesses.dataSource, DBPR),
        eq(businesses.active, true),
      ),
    );
  const gone = stale
    .filter((b) => !b.licenseNumber || !drafts.has(b.licenseNumber))
    .map((b) => b.id);
  if (gone.length) {
    await db
      .update(businesses)
      .set({ active: false, updatedAt: now })
      .where(inArray(businesses.id, gone));
  }

  const active = all.filter((d) => d.active).length;
  return { created, updated, active, inactive: seen.length - active + gone.length, skipped };
}
