// Mail routing defaults (docs/plans/MAIL.md). Roles are the same for every town: the local part
// of the address picks the team, and anything unknown goes to the catch-all team. The owner
// can reassign addresses in the database; `pnpm mail:routing:sync` only adds missing rows, so
// it never undoes a reassignment.

export const defaultTeams = ['Admin', 'Sales', 'Editorial'] as const;

export type DefaultTeam = (typeof defaultTeams)[number];

export const defaultRoleAddresses: readonly { localPart: string; team: DefaultTeam }[] = [
  { localPart: 'admin', team: 'Admin' },
  { localPart: 'billing', team: 'Admin' },
  { localPart: 'privacy', team: 'Admin' },
  { localPart: 'sales', team: 'Sales' },
  { localPart: 'advertise', team: 'Sales' },
  // news@ is each site's public contact (townContactEmail) and the newsletter Reply-To.
  { localPart: 'news', team: 'Editorial' },
  { localPart: 'editor', team: 'Editorial' },
  { localPart: 'tips', team: 'Editorial' },
  { localPart: 'corrections', team: 'Editorial' },
];

export const catchAllTeam: DefaultTeam = 'Admin';

/**
 * Warm-up ramp for each new news. subdomain (brief §7.4): the daily bulk cap starts at 50 and
 * doubles every 3 healthy days up to the target. A breach holds the ramp; two in a row step back.
 */
export const warmup = {
  startCap: 50,
  doubleEveryDays: 3,
  targetCap: 50_000,
} as const;
