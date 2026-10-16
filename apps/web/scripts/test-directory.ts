import { and, businesses, eq, type Db, type Town } from '@towncore/db';

// Fictional directory listings for the fixture towns (never Boca), so e2e covers the directory
// pages: one category with enough listings to be indexed, one thin one, and a claimed listing.
// Every name is invented and every license number starts with "TEST".

export const TEST_DIRECTORY_SOURCE = 'test-fixture';

type Fixture = {
  name: string;
  category: string;
  licenseType: string;
  claimed?: { phone: string; website: string; address: string };
};

const fixtures: Fixture[] = [
  {
    name: 'Anchor Plumbing Co',
    category: 'plumbers',
    licenseType: 'Certified Plumbing Contractor',
    claimed: {
      phone: '(207) 555-0142',
      website: 'https://anchor-plumbing.test',
      address: '12 Wharf St',
    },
  },
  {
    name: 'Bayside Pipe and Drain',
    category: 'plumbers',
    licenseType: 'Certified Plumbing Contractor',
  },
  { name: 'Cove Plumbing', category: 'plumbers', licenseType: 'Registered Plumbing Contractor' },
  {
    name: 'Dockside Water Works',
    category: 'plumbers',
    licenseType: 'Certified Plumbing Contractor',
  },
  {
    name: 'Eastern Point Plumbing',
    category: 'plumbers',
    licenseType: 'Certified Plumbing Contractor',
  },
  { name: 'Ferry Lane Roofing', category: 'roofers', licenseType: 'Certified Roofing Contractor' },
  { name: 'Gull Rock Roofers', category: 'roofers', licenseType: 'Certified Roofing Contractor' },
  {
    name: 'Harbor Light Chowder House',
    category: 'restaurants',
    licenseType: 'Permanent Food Service, seating',
  },
];

export async function seedTestDirectory(db: Db, town: Town): Promise<number> {
  await db
    .delete(businesses)
    .where(and(eq(businesses.townId, town.id), eq(businesses.dataSource, TEST_DIRECTORY_SOURCE)));
  const zip = '04000';
  await db.insert(businesses).values(
    fixtures.map((f, i) => {
      const license = `TEST${String(i + 1).padStart(4, '0')}`;
      return {
        townId: town.id,
        slug: `${f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${license.toLowerCase()}`,
        name: f.name,
        category: f.category,
        licenseType: f.licenseType,
        licenseNumber: license,
        licenseVerified: true,
        licenseExpiresAt: new Date('2099-08-31T00:00:00Z'),
        dataSource: TEST_DIRECTORY_SOURCE,
        city: town.name.toUpperCase(),
        zip,
        // Unclaimed listings keep a street on file that must never be shown (D-M6-2).
        address: f.claimed?.address ?? `${100 + i} Private Home Rd`,
        ...(f.claimed
          ? {
              phone: f.claimed.phone,
              website: f.claimed.website,
              claimedAt: new Date('2026-10-01T12:00:00Z'),
              claimedByEmail: 'owner@anchor-plumbing.test',
            }
          : {}),
      };
    }),
  );
  return fixtures.length;
}
