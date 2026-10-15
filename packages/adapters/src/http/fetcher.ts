import robotsParser from 'robots-parser';
import { documentedApi, isBlockedUrl, MIN_INTERVAL_MS, USER_AGENT } from './policy';

// The only way adapters may make HTTP requests (a lint rule bans bare fetch in this package).
// Every request: never-scrape list → robots.txt → 1 request/second per host → timeout + retries.

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

type Robots = { isAllowed(url: string, ua?: string): boolean | undefined };
const ROBOTS_TTL_MS = 24 * 3_600_000;
/** The slowest we'll pace a host after 429s. */
const MAX_INTERVAL_MS = 10_000;

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
    const target = new URL(url);
    const blocked = isBlockedUrl(target);
    if (blocked) throw new FetchPolicyError(`Refusing to fetch ${url}: ${blocked}`);
    // Documented APIs that invite automated use skip robots.txt (Rule 8 exception); pages never do.
    if (!documentedApi(target) && !(await this.allowedByRobots(target))) {
      throw new FetchPolicyError(`Refusing to fetch ${url}: disallowed by robots.txt`);
    }
    return this.request(target, headers);
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

  /** RFC 9309: 4xx robots.txt → no restrictions; 5xx or unreachable → treat as fully disallowed. */
  async allowedByRobots(target: URL): Promise<boolean> {
    const origin = target.origin;
    let entry = this.robots.get(origin);
    if (!entry || entry.expires <= this.now()) {
      const robotsUrl = `${origin}/robots.txt`;
      let robots: Robots | 'allow-all' | 'disallow-all';
      try {
        const response = await this.request(new URL(robotsUrl), {}, 1);
        if (response.ok) robots = robotsParser(robotsUrl, await response.text()) as Robots;
        else
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
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await this.throttled(target.host, () =>
          this.fetchImpl(target.toString(), {
            headers: { 'user-agent': this.userAgent, ...headers },
            signal: AbortSignal.timeout(this.timeoutMs),
            redirect: 'follow',
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

  private slowDown(host: string) {
    this.hostInterval.set(
      host,
      Math.min(MAX_INTERVAL_MS, Math.max(1_000, this.intervalFor(host) * 2)),
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
