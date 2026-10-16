import type { Fetcher } from '@towncore/adapters';

// Domains for a new town (CLAUDE.md §10b; docs/plans/M7.md §4). Availability and price come from
// Vercel's registrar (our DNS provider, D-M7-8), cross-checked against the .com registry over
// RDAP; history comes from the Internet Archive, so we never buy a domain a news site used
// before ("expired domain abuse"). Buying is the only call that spends money: it needs the team
// token, the price the owner approved (`expectedPrice`) and a typed confirmation in the CLI.

const VERCEL = 'https://api.vercel.com';

export type DomainQuote =
  | { domain: string; available: false }
  | {
      domain: string;
      available: true;
      price: number;
      renewalPrice: number;
      premium: boolean;
      years: number;
    };

/** Availability and first-year price for up to 200 names (no auth needed). */
export async function searchDomains(fetcher: Fetcher, domains: string[]): Promise<DomainQuote[]> {
  if (domains.length === 0) return [];
  const { status, body } = await fetcher.postJson<{ results?: DomainQuote[] }>(
    `${VERCEL}/v1/registrar/domains/search`,
    { domains: domains.slice(0, 200) },
    {},
    3,
  );
  if (status !== 200 || !body?.results) throw new Error(`Domain search failed: HTTP ${status}`);
  return body.results;
}

/**
 * Whether the .com registry has the name (RDAP: 200 registered, 404 free). Other endings return
 * null: we only cross-check where Verisign's RDAP terms cover it (lookups "reasonably necessary
 * to register domain names").
 */
export async function registeredInRegistry(
  fetcher: Fetcher,
  domain: string,
): Promise<boolean | null> {
  if (!domain.endsWith('.com')) return null;
  const response = await fetcher.get(`https://rdap.verisign.com/com/v1/domain/${domain}`, {
    accept: 'application/rdap+json',
  });
  if (response.status === 200) return true;
  if (response.status === 404) return false;
  return null;
}

export type Registrant = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address1: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  companyName?: string;
};

/** The registrant contact from env (REGISTRANT_*), or null with the names of what's missing. */
export function registrantFromEnv(
  env: Record<string, string | undefined>,
): { contact: Registrant; missing: [] } | { contact: null; missing: string[] } {
  const fields = {
    firstName: 'REGISTRANT_FIRST_NAME',
    lastName: 'REGISTRANT_LAST_NAME',
    email: 'REGISTRANT_EMAIL',
    phone: 'REGISTRANT_PHONE',
    address1: 'REGISTRANT_ADDRESS1',
    city: 'REGISTRANT_CITY',
    state: 'REGISTRANT_STATE',
    zip: 'REGISTRANT_ZIP',
    country: 'REGISTRANT_COUNTRY',
  } as const;
  const missing = Object.values(fields).filter((k) => !env[k]?.trim());
  if (missing.length) return { contact: null, missing };
  const contact = Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, env[v]!.trim()]),
  ) as Registrant;
  if (env.REGISTRANT_COMPANY?.trim()) contact.companyName = env.REGISTRANT_COMPANY.trim();
  return { contact, missing: [] };
}

export type Purchase = { orderId: string; status: string; price: number | null };

/**
 * Buys one domain for a year with auto-renew. Vercel charges only if the price still equals
 * `expectedPrice`, so the owner pays exactly what they approved. Sent once; never retried.
 */
export async function buyDomain(
  fetcher: Fetcher,
  input: {
    token: string;
    teamId?: string;
    domain: string;
    expectedPrice: number;
    contact: Registrant;
  },
): Promise<{ orderId: string }> {
  const team = input.teamId ? `?teamId=${encodeURIComponent(input.teamId)}` : '';
  const { status, body } = await fetcher.postJson<{ orderId?: string; error?: unknown }>(
    `${VERCEL}/v1/registrar/domains/${input.domain}/buy${team}`,
    {
      autoRenew: true,
      years: 1,
      expectedPrice: input.expectedPrice,
      contactInformation: input.contact,
    },
    { authorization: `Bearer ${input.token}` },
  );
  if (status >= 300 || !body?.orderId)
    throw new Error(`Vercel refused the purchase (HTTP ${status}): ${JSON.stringify(body)}`);
  return { orderId: body.orderId };
}

export async function domainOrder(
  fetcher: Fetcher,
  input: { token: string; teamId?: string; orderId: string },
): Promise<Purchase> {
  const team = input.teamId ? `?teamId=${encodeURIComponent(input.teamId)}` : '';
  const order = await fetcher.getJson<{
    orderId: string;
    status: string;
    domains: Array<{ status: string; price?: number }>;
  }>(`${VERCEL}/v1/registrar/orders/${input.orderId}${team}`, {
    authorization: `Bearer ${input.token}`,
  });
  return {
    orderId: order.orderId,
    status: order.domains[0]?.status ?? order.status,
    price: order.domains[0]?.price ?? null,
  };
}

export type Snapshot = { timestamp: string; status: string };

/** One archived capture per year of the domain's home page (Wayback CDX API, no key). */
export async function archiveYears(fetcher: Fetcher, domain: string): Promise<Snapshot[]> {
  const url = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&output=json&fl=timestamp,statuscode&filter=statuscode:200&collapse=timestamp:4&limit=40`;
  const rows = await fetcher.getJson<string[][]>(url);
  return (rows ?? [])
    .slice(1)
    .map(([timestamp, status]) => ({ timestamp: timestamp!, status: status! }));
}

/** What a captured home page says about its site. Signals, not a verdict: people review it. */
export function newsSignals(html: string): string[] {
  const text = html.toLowerCase();
  const signals: string[] = [];
  if (
    /property=["']og:type["'][^>]*content=["']article/.test(text) ||
    /content=["']article["'][^>]*property=["']og:type/.test(text)
  )
    signals.push('og:type article');
  if (/"@type"\s*:\s*"(newsarticle|newsmediaorganization|reportagenewsarticle)"/.test(text))
    signals.push('news structured data');
  const title = text.match(/<title[^>]*>([^<]*)<\/title>/)?.[1] ?? '';
  if (
    /\b(news|times|gazette|herald|journal|tribune|courier|ledger|post|daily|chronicle|observer|patch)\b/.test(
      title,
    )
  )
    signals.push(`news word in title: "${title.trim().slice(0, 80)}"`);
  const sections = [
    'obituaries',
    'breaking news',
    'local news',
    'sports',
    'opinion',
    'letters to the editor',
    'police blotter',
  ].filter((w) => text.includes(w));
  if (sections.length >= 2) signals.push(`news sections: ${sections.join(', ')}`);
  const datedLinks = (text.match(/href=["'][^"']*\/20\d\d\/\d\d\//g) ?? []).length;
  if (datedLinks >= 10) signals.push(`${datedLinks} dated story links`);
  return signals;
}

export type PriorUse = {
  captures: number;
  years: string[];
  /** A capture with at least two news signals: the domain was a news site. */
  news: boolean;
  checked: Array<{ timestamp: string; signals: string[] }>;
};

/**
 * Was the domain someone's website before, and was it news? Reads up to `samples` captures
 * (first, middle, last) at the archive's 1 request a second. Null when the archive didn't answer.
 */
export async function priorUse(
  fetcher: Fetcher,
  domain: string,
  samples = 3,
): Promise<PriorUse | null> {
  // The archive is often slow or busy; null means "not checked", never "no history".
  const years = await archiveYears(fetcher, domain).catch(() => null);
  if (years === null) return null;
  if (years.length === 0) return { captures: 0, years: [], news: false, checked: [] };
  const picks = [...new Set([0, Math.floor(years.length / 2), years.length - 1])]
    .slice(0, samples)
    .map((i) => years[i]!);
  const checked: PriorUse['checked'] = [];
  for (const s of picks) {
    const response = await fetcher
      .get(`https://web.archive.org/web/${s.timestamp}id_/http://${domain}/`)
      .catch(() => null);
    if (!response?.ok) return null;
    const html = (await response.text()).slice(0, 500_000);
    checked.push({ timestamp: s.timestamp, signals: newsSignals(html) });
  }
  return {
    captures: years.length,
    years: years.map((y) => y.timestamp.slice(0, 4)),
    news: checked.some((c) => c.signals.length >= 2),
    checked,
  };
}
