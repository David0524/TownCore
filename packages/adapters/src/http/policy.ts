// Scraping etiquette (CLAUDE.md Rule 8), enforced in code rather than left to prompts.

/** Until towncore.net/bot is published, identify by email only (decision D-M2-3). */
export const USER_AGENT = 'TownCoreBot/1.0 (info@towncore.net)';

/** Minimum gap between requests to the same host. */
export const MIN_INTERVAL_MS = 1_000;

/**
 * Hosts we never fetch, whatever robots.txt says: Google Maps, Yelp, Facebook, Nextdoor and
 * paid sports databases. Matches the host and any subdomain.
 */
const BLOCKED_HOSTS = [
  'yelp.com',
  'facebook.com',
  'fb.com',
  'fbcdn.net',
  'nextdoor.com',
  'maxpreps.com',
  'hudl.com',
  '247sports.com',
  'rivals.com',
  'on3.com',
];

export function isBlockedUrl(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  for (const blocked of BLOCKED_HOSTS) {
    if (host === blocked || host.endsWith(`.${blocked}`))
      return `${blocked} is on the never-scrape list`;
  }
  const isGoogle = /(^|\.)google\.[a-z.]+$/.test(host);
  if (host.startsWith('maps.google.') || (isGoogle && url.pathname.startsWith('/maps'))) {
    return 'Google Maps is on the never-scrape list';
  }
  if (host === 'maps.googleapis.com' || host === 'goo.gl')
    return 'Google Maps is on the never-scrape list';
  return null;
}
