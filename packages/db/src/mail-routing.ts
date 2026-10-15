import { catchAllTeam, defaultRoleAddresses, defaultTeams } from '@towncore/config';
import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { roleAddresses, teams } from './schema';

// Seeds the default teams and role addresses (packages/config/src/mail.ts). It only adds what's
// missing, so a team the owner reassigned an address to stays reassigned. A default address
// that was deleted comes back on the next run, and a catch-all row is created if none exists
// (routing needs exactly one).

export type SyncMailRoutingResult = { teamsAdded: string[]; addressesAdded: string[] };

export async function syncMailRouting(db: Db): Promise<SyncMailRoutingResult> {
  return db.transaction(async (tx) => {
    const teamsAdded = (
      await tx
        .insert(teams)
        .values(defaultTeams.map((name) => ({ name })))
        .onConflictDoNothing({ target: teams.name })
        .returning({ name: teams.name })
    ).map((row) => row.name);
    const teamIds = new Map(
      (await tx.select({ id: teams.id, name: teams.name }).from(teams)).map((t) => [t.name, t.id]),
    );
    const teamId = (name: string) => {
      const id = teamIds.get(name);
      if (!id) throw new Error(`Team ${name} is missing`);
      return id;
    };

    const addressesAdded = (
      await tx
        .insert(roleAddresses)
        .values(
          defaultRoleAddresses.map((r) => ({ localPart: r.localPart, teamId: teamId(r.team) })),
        )
        .onConflictDoNothing({ target: roleAddresses.localPart })
        .returning({ localPart: roleAddresses.localPart })
    ).map((row) => `${row.localPart}@`);

    const [catchAll] = await tx
      .select({ id: roleAddresses.id })
      .from(roleAddresses)
      .where(eq(roleAddresses.isCatchAll, true));
    if (!catchAll) {
      await tx
        .insert(roleAddresses)
        .values({ localPart: null, teamId: teamId(catchAllTeam), isCatchAll: true });
      addressesAdded.push('(catch-all)');
    }
    return { teamsAdded, addressesAdded };
  });
}

export type RoutingTable = {
  /** Local part → team id. */
  roles: ReadonlyMap<string, string>;
  catchAllTeamId: string;
};

/** The current role → team map, for routing inbound mail. */
export async function loadRoutingTable(db: Db): Promise<RoutingTable> {
  const rows = await db
    .select({
      localPart: roleAddresses.localPart,
      teamId: roleAddresses.teamId,
      isCatchAll: roleAddresses.isCatchAll,
    })
    .from(roleAddresses);
  const catchAll = rows.find((r) => r.isCatchAll);
  if (!catchAll) throw new Error('No catch-all role address. Run `pnpm mail:routing:sync`.');
  return {
    roles: new Map(rows.filter((r) => r.localPart).map((r) => [r.localPart!, r.teamId])),
    catchAllTeamId: catchAll.teamId,
  };
}
