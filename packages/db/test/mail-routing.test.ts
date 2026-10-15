import { catchAllTeam, defaultRoleAddresses, defaultTeams } from '@towncore/config';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/client';
import { loadRoutingTable, syncMailRouting } from '../src/mail-routing';
import { roleAddresses, teams } from '../src/schema';
import { createTestDb } from '../src/testing';

let db: Db;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ db, drop } = await createTestDb());
});
afterAll(async () => drop());

describe('mail routing', () => {
  it('seeds the default teams, role addresses and one catch-all', async () => {
    const first = await syncMailRouting(db);
    expect(first.teamsAdded.sort()).toEqual([...defaultTeams].sort());
    expect(first.addressesAdded).toHaveLength(defaultRoleAddresses.length + 1);

    const table = await loadRoutingTable(db);
    const teamName = new Map((await db.select().from(teams)).map((t) => [t.id, t.name]));
    expect(teamName.get(table.roles.get('sales')!)).toBe('Sales');
    expect(teamName.get(table.roles.get('news')!)).toBe('Editorial');
    expect(teamName.get(table.catchAllTeamId)).toBe(catchAllTeam);
  });

  it('a second run adds nothing and keeps the owner’s changes', async () => {
    const [editorial] = await db.select().from(teams).where(eq(teams.name, 'Editorial'));
    await db
      .update(roleAddresses)
      .set({ teamId: editorial!.id })
      .where(eq(roleAddresses.localPart, 'sales'));
    await db.delete(roleAddresses).where(eq(roleAddresses.localPart, 'tips'));

    expect(await syncMailRouting(db)).toEqual({
      teamsAdded: [],
      addressesAdded: ['tips@'],
    });
    const table = await loadRoutingTable(db);
    expect(table.roles.get('sales')).toBe(editorial!.id);
  });

  it('the database allows only one catch-all, and only lowercase local parts', async () => {
    const [admin] = await db.select().from(teams).where(eq(teams.name, 'Admin'));
    await expect(
      db.insert(roleAddresses).values({ localPart: null, teamId: admin!.id, isCatchAll: true }),
    ).rejects.toThrow();
    await expect(
      db.insert(roleAddresses).values({ localPart: 'Sales+x', teamId: admin!.id }),
    ).rejects.toThrow();
    await expect(
      db.insert(roleAddresses).values({ localPart: null, teamId: admin!.id }),
    ).rejects.toThrow();
  });
});
