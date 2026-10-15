import { categoryForLicense } from '@towncore/config';
import { displayName } from './names';

// Turns one state license record into a directory listing (D-M6-1, D-M6-2). Only active,
// categorized licenses become listings; everything else returns a reason, for the seeding log.

export type ListingDraft = {
  licenseNumber: string;
  category: string;
  licenseType: string;
  name: string;
  /** Street only. Stored for geocoding and for the owner once claimed; never shown before. */
  address: string | null;
  city: string;
  zip: string | null;
  active: boolean;
  expiresAt: Date | null;
  /** Rows with a DBA name are preferred when several rows share one license. */
  hasDba: boolean;
};

export type LicenseRecord = { type: string; raw: unknown };

/** MM/DD/YYYY → Date (UTC midnight), or null. */
function parseDate(value: unknown): Date | null {
  const m = typeof value === 'string' ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value) : null;
  return m ? new Date(Date.UTC(+m[3]!, +m[1]! - 1, +m[2]!)) : null;
}

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function street(raw: Record<string, unknown>): string | null {
  return [raw.address1, raw.address2, raw.address3].map(str).filter(Boolean).join(', ') || null;
}

function zip5(value: unknown): string | null {
  const m = /^(\d{5})/.exec(str(value));
  return m ? m[1]! : null;
}

export function listingFromRecord(
  record: LicenseRecord,
  now: Date,
): ListingDraft | { skip: string } {
  const raw = (record.raw ?? {}) as Record<string, unknown>;
  const expiresAt = parseDate(raw.expirationDate);
  const expired = expiresAt !== null && expiresAt.getTime() < now.getTime();

  if (record.type === 'food_license') {
    const category = categoryForLicense(`food:${str(raw.licenseType)}:${str(raw.rank)}`);
    if (!category) return { skip: 'uncategorized' };
    const license = str(raw.licenseNumber);
    if (!license) return { skip: 'no license number' };
    const business = str(raw.businessName) || str(raw.licenseeName);
    return {
      licenseNumber: license,
      category: category.slug,
      licenseType: str(raw.occupation),
      name: displayName(business),
      address: street(raw),
      city: str(raw.city),
      zip: zip5(raw.zip),
      // The file lists active licenses only; an expiry date in the past means it has lapsed.
      active: !expired,
      expiresAt,
      hasDba: Boolean(str(raw.businessName)),
    };
  }

  if (record.type === 'license') {
    const category = categoryForLicense(`${str(raw.board)}:${str(raw.occupationCode)}`);
    if (!category) return { skip: 'uncategorized' };
    // "Construction Business Information" rows have no license number (see pipeline templates).
    const license =
      str(raw.alternateLicenseNumber) ||
      (str(raw.licenseNumber) ? `${str(raw.occupationCode)}${str(raw.licenseNumber)}` : '');
    if (!license) return { skip: 'no license number' };
    const dba = str(raw.dbaName);
    return {
      licenseNumber: license,
      category: category.slug,
      licenseType: str(raw.occupation),
      name: displayName(dba || str(raw.licenseeName)),
      address: street(raw),
      city: str(raw.city),
      zip: zip5(raw.zip),
      // Current (or on probation) and Active: allowed to work. Inactive licensees can't contract.
      active:
        ['C', 'P'].includes(str(raw.primaryStatus)) && str(raw.secondaryStatus) === 'A' && !expired,
      expiresAt,
      hasDba: Boolean(dba),
    };
  }

  return { skip: `not a license record (${record.type})` };
}
