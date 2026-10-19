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

/**
 * Proxies, feed bridges, scraping services and page caches: never fetched, for any source.
 * Each one fetches a site for us from someone else's IP or copy, so reading a page through it
 * gets around that site's robots.txt or IP block, which still breaks Rule 8: a disallow means we
 * don't read that host or path at all, however the bytes reach us. A site that blocks us is a
 * broken source (re-checked weekly), never one to route around. Matches the host and any
 * subdomain.
 */
const PROXY_HOSTS = [
  // Feed bridges that turn a site (or a social page) into RSS by scraping it for us.
  'rsshub.app',
  'politepol.com',
  'fetchrss.com',
  'rss.app',
  'feed43.com',
  'morss.it',
  'rss-bridge.org',
  // Scraping and transcript services that fetch through residential or rotating IPs.
  'supadata.ai',
  'scraperapi.com',
  'scrapingbee.com',
  'scrapingant.com',
  'zenrows.com',
  'crawlbase.com',
  'brightdata.com',
  'oxylabs.io',
  'smartproxy.com',
  'webshare.io',
  'zyte.com',
  'apify.com',
  'firecrawl.dev',
  'r.jina.ai',
  '12ft.io',
  // Page caches and archives: someone else's copy of a page we may not read.
  'archive.org',
  'archive.ph',
  'archive.today',
  'archive.is',
  'archive.li',
  'archive.md',
  'archive.vn',
  'ghostarchive.org',
  'webcache.googleusercontent.com',
  'translate.goog',
];

/** A host label of a self-hosted RSSHub or RSS-Bridge mirror (rsshub.example.org, rsshub2.x). */
const BRIDGE_LABEL = /^(rsshub|rss-?bridge)(\d*|-.*)$/;

export type PolicyPurpose = {
  /**
   * The launcher's expired-domain check (§10b) reads the Internet Archive's history of a domain
   * we may buy, from web.archive.org only. That's the archive's own record of a domain, not a
   * copy of a source we write from, so it's the one allowed use of an archive host.
   */
  domainHistory?: boolean;
};

export function isBlockedUrl(url: URL, purpose: PolicyPurpose = {}): string | null {
  const host = url.hostname.toLowerCase();
  const matches = (listed: string) => host === listed || host.endsWith(`.${listed}`);
  for (const blocked of BLOCKED_HOSTS) {
    if (matches(blocked)) return `${blocked} is on the never-scrape list`;
  }
  if (!(purpose.domainHistory && host === 'web.archive.org')) {
    for (const proxy of PROXY_HOSTS) {
      if (matches(proxy))
        return `${proxy} is a proxy, feed bridge or page cache on the never-scrape list (it would get around a site's robots.txt)`;
    }
  }
  if (host.split('.').some((label) => BRIDGE_LABEL.test(label)))
    return `${host} looks like an RSSHub or RSS-Bridge mirror, a feed bridge on the never-scrape list`;
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
  // Owner approved 2026-10-16 (Unsplash for guide photos). api.unsplash.com's robots.txt is
  // `Disallow: /` for crawlers; the API itself is for registered apps, which send their access
  // key. Only this API host; unsplash.com pages are never fetched by code. Images are hotlinked
  // by readers' browsers from images.unsplash.com, as Unsplash requires.
  'api.unsplash.com': {
    name: 'Unsplash API',
    terms: 'https://unsplash.com/api-terms',
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
