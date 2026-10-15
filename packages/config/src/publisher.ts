// The publisher of every site (CLAUDE.md Rule 1). Sites look independent: TownCore appears only
// in the publisher line on each site's About and Privacy pages, never in site chrome.
export const publisher = {
  name: 'TownCore',
  // Internal inbox that per-site addresses (news@{domain}) forward to. Not shown on sites.
  inbox: 'info@towncore.net',
  // Company Google Workspace domain. Only accounts on it may sign in to /admin (D-MAIL-2).
  hqDomain: 'towncore.net',
} as const;

/** The line About and Privacy pages must show. */
export function publisherLine(siteName: string): string {
  return `${siteName} is published by ${publisher.name}.`;
}
