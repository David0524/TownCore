import { adminActions, eq, staff, towns, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GoLiveRefused, setSearchHidden } from '../src/golive';

// The search kill switch (owner, 2026-10-17): an admin hides a town, or a whole launch cohort,
// from search engines and shows it again; every change is audited with the reason.

let db: Db;
let drop: () => Promise<void>;
let admin: { id: string; role: 'admin' };
let reviewer: { id: string; role: 'reviewer' };

const town = (slug: string, cohort: string | null) => ({
  slug,
  name: slug,
  state: 'ZZ',
  county: 'Sample',
  timezone: 'America/New_York',
  domain: `${slug}.test`,
  siteName: `${slug} Square`,
  status: 'live' as const,
  tier: 'small' as const,
  config: {},
  cohort,
});

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  const [a] = await db
    .insert(staff)
    .values({ email: 'admin@towncore.net', name: 'A', role: 'admin' })
    .returning();
  const [r] = await db
    .insert(staff)
    .values({ email: 'reviewer@towncore.net', name: 'R', role: 'reviewer' })
    .returning();
  admin = { id: a!.id, role: 'admin' };
  reviewer = { id: r!.id, role: 'reviewer' };
  await db
    .insert(towns)
    .values([town('one', '2027-01'), town('two', '2027-01'), town('three', '2027-02')]);
});
afterAll(async () => drop());

describe('search kill switch', () => {
  it('hides a cohort, shows one town again, and audits each change', async () => {
    await expect(
      setSearchHidden(db, { staff: reviewer, hidden: true, reason: 'x', cohort: '2027-01' }),
    ).rejects.toThrow(GoLiveRefused);
    await expect(
      setSearchHidden(db, { staff: admin, hidden: true, reason: ' ', cohort: '2027-01' }),
    ).rejects.toThrow(/Say why/);

    const hidden = await setSearchHidden(db, {
      staff: admin,
      hidden: true,
      reason: 'Indexing dropped in Search Console',
      cohort: '2027-01',
    });
    expect(hidden.map((t) => t.slug).sort()).toEqual(['one', 'two']);
    const rows = await db.select().from(towns);
    expect(
      rows
        .filter((t) => t.searchHidden)
        .map((t) => t.slug)
        .sort(),
    ).toEqual(['one', 'two']);

    const [one] = rows.filter((t) => t.slug === 'one');
    await setSearchHidden(db, {
      staff: admin,
      hidden: false,
      reason: 'Recovered',
      townId: one!.id,
    });
    await expect(
      setSearchHidden(db, { staff: admin, hidden: false, reason: 'again', townId: one!.id }),
    ).rejects.toThrow(/already shown in search/);

    const log = await db.select().from(adminActions).where(eq(adminActions.staffId, admin.id));
    expect(log.map((l) => l.action).sort()).toEqual([
      'town.search_hide',
      'town.search_hide',
      'town.search_show',
    ]);
    expect(log.find((l) => l.action === 'town.search_show')!.detail).toMatchObject({
      slug: 'one',
      cohort: '2027-01',
      reason: 'Recovered',
    });
  });
});
