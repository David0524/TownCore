import robotsParser from 'robots-parser';
import { documentedApi, isBlockedUrl, MIN_INTERVAL_MS, USER_AGENT } from './policy';

// The only way adapters may make HTTP requests (a lint rule bans bare fetch in this package).
// Every request: never-scrape list → robots.txt (including Crawl-delay) → at most 1 request a
// second per host → timeout + retries. Redirects are followed by hand, and every hop passes the
// same checks, so a redirect can never lead to a host or path robots.txt disallows.

export class FetchPolicyError extends Error {}

/** Thrown by an adapter when its source hasn't changed since the last run (e.g. HTTP 304). */
export class NotModified extends Error {}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** The platform fetch. Only ever passed into a Fetcher (directly or via the fixture recorder). */
export const defaultFetch: FetchFn = (input, init) => globalThis.fetch(input, init);

export type FetcherOptions = {
  fetchImpl?: FetchFn;
  userAgent?: string;
  minIntervalMs?: number;
  timeoutMs?: number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

type Robots = {
  isAllowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
};
const ROBOTS_TTL_MS = 24 * 3_600_000;
/** The slowest we'll pace a host after 429s. */
const MAX_INTERVAL_MS = 10_000;
/** The longest robots.txt Crawl-delay we honor as asked; longer delays are capped here. */
const MAX_CRAWL_DELAY_MS = 60_000;
/** Redirect hops followed per request (RFC 9309 asks crawlers to follow at least five). */
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Retry-After as seconds or an HTTP date, capped at 60s. */
export function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1_000 : new Date(value).getTime() - now;
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, 60_000) : null;
}

export class Fetcher {
  private readonly fetchImpl: FetchFn;
  private readonly userAgent: string;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly hostQueue = new Map<string, Promise<void>>();
  private readonly lastRequestAt = new Map<string, number>();
  /** Per-host spacing; starts at minIntervalMs and grows when a host says we're too fast. */
  private readonly hostInterval = new Map<string, number>();
  private readonly robots = new Map<
    string,
    { robots: Robots | 'allow-all' | 'disallow-all'; expires: number }
  >();

  constructor(options: FetcherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.userAgent = options.userAgent ?? USER_AGENT;
    this.minIntervalMs = options.minIntervalMs ?? MIN_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.retries = options.retries ?? 3;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
  }

  /** GET a URL politely. Throws FetchPolicyError if the URL is blocked or disallowed. */
  async get(url: string, headers: Record<string, string> = {}): Promise<Response> {
    let target = new URL(url);
    for (let hop = 0; ; hop++) {
      await this.checkPolicy(target, url);
      const response = await this.request(target, headers);
      const location = response.headers.get('location');
      if (!REDIRECT_STATUSES.has(response.status) || !location) return response;
      if (hop === MAX_REDIRECTS) throw new Error(`GET ${url} failed: too many redirects`);
      target = new URL(location, target);
    }
  }

  /** Rule 8 for one URL: the never-scrape list, then robots.txt (documented APIs excepted). */
  private async checkPolicy(target: URL, requested: string): Promise<void> {
    const via = target.toString() === requested ? '' : ` (redirected from ${requested})`;
    const blocked = isBlockedUrl(target);
    if (blocked) throw new FetchPolicyError(`Refusing to fetch ${target}${via}: ${blocked}`);
    // Documented APIs that invite automated use skip robots.txt (Rule 8 exception); pages never do.
    if (!documentedApi(target) && !(await this.allowedByRobots(target))) {
      throw new FetchPolicyError(`Refusing to fetch ${target}${via}: disallowed by robots.txt`);
    }
  }

  async getText(url: string, headers: Record<string, string> = {}): Promise<string> {
    const response = await this.get(url, headers);
    if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`);
    return response.text();
  }

  async getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const response = await this.get(url, { accept: 'application/json', ...headers });
    if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`);
    return (await response.json()) as T;
  }

  /**
   * POST JSON to a documented API (Rule 8 allowlist only; never a page). Sent once unless
   * `attempts` says otherwise, so a request that changes something (a purchase) is never repeated.
   */
  async postJson<T>(
    url: string,
    body: unknown,
    headers: Record<string, string> = {},
    attempts = 1,
  ): Promise<{ status: number; body: T }> {
    const target = new URL(url);
    if (!documentedApi(target))
      throw new FetchPolicyError(`Refusing to POST to ${url}: not a documented API`);
    const response = await this.request(
      target,
      { accept: 'application/json', 'content-type': 'application/json', ...headers },
      attempts,
      { method: 'POST', body: JSON.stringify(body) },
    );
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
  }

  /** RFC 9309: 4xx robots.txt → no restrictions; 5xx or unreachable → treat as fully disallowed. */
  async allowedByRobots(target: URL): Promise<boolean> {
    const origin = target.origin;
    let entry = this.robots.get(origin);
    if (!entry || entry.expires <= this.now()) {
      const robotsUrl = `${origin}/robots.txt`;
      let robots: Robots | 'allow-all' | 'disallow-all';
      try {
        // RFC 9309: robots.txt itself may redirect (http → https, bare → www); follow those.
        const response = await this.request(new URL(robotsUrl), {}, 1, { redirect: 'follow' });
        if (response.ok) {
          robots = robotsParser(robotsUrl, await response.text()) as Robots;
          this.applyCrawlDelay(target.host, robots);
        } else
          robots = response.status >= 400 && response.status < 500 ? 'allow-all' : 'disallow-all';
      } catch {
        robots = 'disallow-all';
      }
      entry = { robots, expires: this.now() + ROBOTS_TTL_MS };
      this.robots.set(origin, entry);
    }
    if (entry.robots === 'allow-all') return true;
    if (entry.robots === 'disallow-all') return false;
    return entry.robots.isAllowed(target.toString(), this.userAgent) !== false;
  }

  private async request(
    target: URL,
    headers: Record<string, string>,
    attempts = this.retries,
    // Redirects are returned, not followed, unless asked (get() checks each hop; a POST is never
    // re-sent to wherever it was redirected).
    init: { method?: string; body?: string; redirect?: 'manual' | 'follow' } = {},
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await this.throttled(target.host, () =>
          this.fetchImpl(target.toString(), {
            redirect: 'manual',
            ...init,
            headers: { 'user-agent': this.userAgent, ...headers },
            signal: AbortSignal.timeout(this.timeoutMs),
          }),
        );
        if (response.status === 429) {
          // Too fast for this host: slow down for good, and wait as long as it asks.
          this.slowDown(target.host);
          if (attempt < attempts) {
            lastError = new Error('HTTP 429');
            await this.sleep(
              retryAfterMs(response.headers.get('retry-after')) ?? 2_000 * 2 ** (attempt - 1),
            );
            continue;
          }
          return response;
        }
        if (response.status >= 500 && attempt < attempts) {
          lastError = new Error(`HTTP ${response.status}`);
        } else {
          return response;
        }
      } catch (error) {
        lastError = error;
      }
      await this.sleep(500 * 2 ** (attempt - 1));
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /** Current spacing for a host, in ms (for logging and tests). */
  intervalFor(host: string): number {
    return this.hostInterval.get(host) ?? this.minIntervalMs;
  }

  /** Rule 8: a robots.txt Crawl-delay for our agent (or *) spaces requests at least that far. */
  private applyCrawlDelay(host: string, robots: Robots) {
    const seconds = robots.getCrawlDelay(this.userAgent);
    if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return;
    const ms = Math.min(MAX_CRAWL_DELAY_MS, seconds * 1_000);
    if (ms > this.intervalFor(host)) this.hostInterval.set(host, ms);
  }

  private slowDown(host: string) {
    const current = this.intervalFor(host);
    // Never below what robots.txt asked for.
    this.hostInterval.set(
      host,
      Math.max(current, Math.min(MAX_INTERVAL_MS, Math.max(1_000, current * 2))),
    );
  }

  /** Serializes requests per host and spaces them at least minIntervalMs apart. */
  private throttled<T>(host: string, run: () => Promise<T>): Promise<T> {
    const previous = this.hostQueue.get(host) ?? Promise.resolve();
    const result = previous.then(async () => {
      const interval = this.hostInterval.get(host) ?? this.minIntervalMs;
      const wait = (this.lastRequestAt.get(host) ?? -Infinity) + interval - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt.set(host, this.now());
      return run();
    });
    this.hostQueue.set(
      host,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }
}
