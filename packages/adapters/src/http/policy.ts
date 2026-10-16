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

/**
 * Official APIs whose published terms invite automated access (CLAUDE.md Rule 8 exception,
 * approved 2026-10-15). Their hosts' robots.txt targets crawlers, so it isn't consulted for these
 * API hosts; the never-scrape list, rate limit and User-Agent still apply. Add entries only after
 * reading the terms, and record the terms URL. Never add a host to get around a website's robots.
 */
export const DOCUMENTED_APIS: Record<string, { name: string; terms: string }> = {
  'api.weather.gov': {
    name: 'National Weather Service API',
    terms: 'https://www.weather.gov/documentation/services-web-api',
  },
  // Owner approved 2026-10-15. The Division of Corporations publishes a public login and says
  // its files are available "through your browser or a secure FTP client of your choice".
  // Only this file host is listed; Sunbiz search pages are never fetched.
  'sftp.floridados.gov': {
    name: 'Florida Division of Corporations public data downloads',
    terms: 'https://dos.fl.gov/sunbiz/other-services/data-downloads/daily-data/',
  },
  // Owner approved 2026-10-16 (D-M4b-3), after a terms and robots.txt check. The host serves no
  // robots rules (403 on /robots.txt; it's API-only). NOAA data is public domain; NOAA asks for
  // attribution and an `application` name on every request.
  'api.tidesandcurrents.noaa.gov': {
    name: 'NOAA CO-OPS Tides & Currents data API',
    terms: 'https://tidesandcurrents.noaa.gov/disclaimers.html',
  },
  // Owner approved 2026-10-16 (D-M4b-3). data.epa.gov's robots.txt has no rules; listed so the
  // UV endpoint keeps working if that changes. Only this host: enviro.epa.gov disallows all.
  'data.epa.gov': {
    name: 'EPA Envirofacts data service (UV index)',
    terms: 'https://www.epa.gov/enviro/web-services',
  },
  // Owner approved 2026-10-16 (D-M7-12). The Census Bureau's public data downloads (its former FTP
  // server): Gazetteer, population estimates, ACS summary files, relationship files and business
  // patterns, used by `pnpm towns:rank`. Its robots.txt opens with `User-agent: *` and no rules,
  // then a blank line and six named crawlers with `Disallow: /`; RFC 9309 reads that as one group
  // disallowing everyone, though the evident intent is to block those six. The open-data page
  // points to this server "to download full datasets". Only this host; www.census.gov pages are
  // never fetched by code.
  'www2.census.gov': {
    name: 'U.S. Census Bureau public data downloads',
    terms:
      'https://www.census.gov/topics/research/research-transparency-public-access/open-data.html',
  },
  // Owner approved 2026-10-16 with the M7 plan (D-M7-8): Vercel's REST API, our registrar and
  // DNS provider. robots.txt is `Disallow: /` (an API host). Domain search needs no auth; buying
  // needs the team token and runs only behind `--approve-spend` and a typed confirmation.
  'api.vercel.com': {
    name: 'Vercel REST API (domains registrar)',
    terms: 'https://vercel.com/docs/rest-api',
  },
};

export function documentedApi(url: URL): { name: string; terms: string } | null {
  return DOCUMENTED_APIS[url.hostname.toLowerCase()] ?? null;
}
