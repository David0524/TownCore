import type { DnsRecordSpec, ExistingRecord } from './dns';
import { RetryableError, withRetry, type RetryOptions } from './retry';

// Vercel DNS through the REST API (D-MAIL-9), checked against the docs on 2026-10-15:
//   GET  /v5/domains/{domain}           domain info (serviceType 'zeit.world' = Vercel DNS)
//   GET  /v5/domains/{domain}/records   paginated by `until` = pagination.next
//   POST /v2/domains/{domain}/records   create; returns { uid }

export type VercelDomain = {
  name: string;
  serviceType: 'zeit.world' | 'external' | 'na';
  nameservers: string[];
  intendedNameservers: string[];
};

export interface DnsProvider {
  getDomain(domain: string): Promise<VercelDomain | null>;
  listRecords(domain: string): Promise<ExistingRecord[]>;
  createRecord(domain: string, record: DnsRecordSpec, comment: string): Promise<string>;
}

export class VercelApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type VercelRecordRow = {
  id: string;
  name: string;
  type: string;
  value: string;
  mxPriority?: number | null;
};

export function vercelDns(options: {
  token: string;
  teamId?: string;
  fetchImpl?: typeof fetch;
  retry?: RetryOptions;
  baseUrl?: string;
}): DnsProvider {
  const { token, teamId, fetchImpl = fetch, retry, baseUrl = 'https://api.vercel.com' } = options;

  async function call<T>(
    method: 'GET' | 'POST',
    path: string,
    query: Record<string, string> = {},
    body?: unknown,
  ) {
    const url = new URL(path, baseUrl);
    for (const [k, v] of Object.entries({ ...query, ...(teamId ? { teamId } : {}) }))
      url.searchParams.set(k, v);
    return withRetry(async () => {
      const response = await fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 429 || response.status >= 500) {
        throw new RetryableError(
          `Vercel ${method} ${url.pathname}: ${response.status}`,
          retryAfter(response),
        );
      }
      if (response.status === 404) return null;
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new VercelApiError(
          response.status,
          `Vercel ${method} ${url.pathname}: ${response.status} ${detail.slice(0, 300)}`,
        );
      }
      return (await response.json()) as T;
    }, retry);
  }

  return {
    async getDomain(domain) {
      const body = await call<{ domain: VercelDomain }>(
        'GET',
        `/v5/domains/${encodeURIComponent(domain)}`,
      );
      return body?.domain ?? null;
    },
    async listRecords(domain) {
      const out: ExistingRecord[] = [];
      let until: number | null = null;
      for (let page = 0; page < 100; page++) {
        const query: Record<string, string> = { limit: '100' };
        if (until !== null) query.until = String(until);
        const body = await call<{
          records: VercelRecordRow[];
          pagination?: { next: number | null };
        }>('GET', `/v5/domains/${encodeURIComponent(domain)}/records`, query);
        if (!body) throw new VercelApiError(404, `Vercel has no DNS zone for ${domain}`);
        out.push(
          ...body.records.map((r) => ({
            id: r.id,
            name: r.name,
            type: r.type,
            value: r.value,
            priority: r.mxPriority ?? null,
          })),
        );
        until = body.pagination?.next ?? null;
        if (until === null) return out;
      }
      throw new Error(`Too many DNS record pages for ${domain}`);
    },
    async createRecord(domain, record, comment) {
      const body = await call<{ uid: string }>(
        'POST',
        `/v2/domains/${encodeURIComponent(domain)}/records`,
        {},
        {
          type: record.type,
          name: record.name,
          value: record.value,
          ttl: 3600,
          ...(record.type === 'MX' ? { mxPriority: record.priority } : {}),
          comment,
        },
      );
      if (!body?.uid)
        throw new VercelApiError(404, `Vercel could not create a record on ${domain}`);
      return body.uid;
    },
  };
}

function retryAfter(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (header && /^\d+$/.test(header)) return Number(header) * 1000;
  const reset = response.headers.get('x-ratelimit-reset');
  if (reset && /^\d+$/.test(reset)) return Math.max(0, Number(reset) * 1000 - Date.now());
  return undefined;
}

/** True when Vercel serves the domain's DNS (so records we write actually take effect). */
export function usesVercelDns(domain: VercelDomain): boolean {
  if (domain.serviceType !== 'zeit.world') return false;
  const want = new Set(domain.intendedNameservers.map((n) => n.toLowerCase().replace(/\.$/, '')));
  return (
    want.size > 0 &&
    domain.nameservers.length > 0 &&
    domain.nameservers.every((n) => want.has(n.toLowerCase().replace(/\.$/, '')))
  );
}
