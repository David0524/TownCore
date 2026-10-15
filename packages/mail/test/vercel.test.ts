import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { usesVercelDns, vercelDns, VercelApiError } from '../src/vercel';

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/vercel/${name}.json`, import.meta.url), 'utf8'));

type Call = { url: URL; init: RequestInit };
function server(responses: (Response | (() => Response))[]) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: new URL(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return typeof next === 'function' ? next() : next;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const noSleep = { sleep: async () => {}, baseMs: 1 };

describe('vercelDns', () => {
  it('reads a domain with the team id and bearer token', async () => {
    const { calls, fetchImpl } = server([Response.json(fixture('domain'))]);
    const client = vercelDns({ token: 'tok', teamId: 'team_1', fetchImpl });
    const domain = await client.getDomain('testtown.com');
    expect(domain && usesVercelDns(domain)).toBe(true);
    expect(calls[0]!.url.pathname).toBe('/v5/domains/testtown.com');
    expect(calls[0]!.url.searchParams.get('teamId')).toBe('team_1');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('returns null for a domain the team does not have', async () => {
    const { fetchImpl } = server([new Response('{"error":{}}', { status: 404 })]);
    expect(await vercelDns({ token: 't', fetchImpl }).getDomain('nope.com')).toBeNull();
  });

  it('pages through records with `until`', async () => {
    const { calls, fetchImpl } = server([
      Response.json(fixture('records-page1')),
      Response.json(fixture('records-page2')),
    ]);
    const records = await vercelDns({ token: 't', fetchImpl }).listRecords('testtown.com');
    expect(records.map((r) => [r.id, r.type, r.priority])).toEqual([
      ['rec_a', 'ALIAS', null],
      ['rec_b', 'TXT', null],
      ['rec_c', 'MX', 10],
    ]);
    expect(calls[1]!.url.searchParams.get('until')).toBe('1760000000001');
  });

  it('creates an MX with its priority and a comment', async () => {
    const { calls, fetchImpl } = server([Response.json({ uid: 'rec_new' })]);
    const id = await vercelDns({ token: 't', fetchImpl }).createRecord(
      'testtown.com',
      {
        purpose: 'inbound_mx',
        type: 'MX',
        name: '',
        value: 'inbound-smtp.us-east-1.amazonaws.com',
        priority: 10,
      },
      'TownCore mail: inbound_mx',
    );
    expect(id).toBe('rec_new');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.url.pathname).toBe('/v2/domains/testtown.com/records');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      type: 'MX',
      name: '',
      value: 'inbound-smtp.us-east-1.amazonaws.com',
      ttl: 3600,
      mxPriority: 10,
      comment: 'TownCore mail: inbound_mx',
    });
  });

  it('backs off on 429 and 5xx, honoring Retry-After', async () => {
    const sleeps: number[] = [];
    const { fetchImpl } = server([
      new Response('', { status: 429, headers: { 'retry-after': '7' } }),
      new Response('', { status: 503 }),
      Response.json({ uid: 'ok' }),
    ]);
    const client = vercelDns({
      token: 't',
      fetchImpl,
      retry: { baseMs: 1, sleep: async (ms) => void sleeps.push(ms) },
    });
    await expect(
      client.createRecord('x.com', { purpose: 'spf', type: 'TXT', name: '', value: 'v=spf1' }, ''),
    ).resolves.toBe('ok');
    expect(sleeps[0]).toBe(7000);
    expect(sleeps).toHaveLength(2);
  });

  it('does not retry a client error', async () => {
    const { calls, fetchImpl } = server([new Response('{"error":"bad"}', { status: 400 })]);
    const client = vercelDns({ token: 't', fetchImpl, retry: noSleep });
    await expect(
      client.createRecord('x.com', { purpose: 'spf', type: 'TXT', name: '', value: 'v' }, ''),
    ).rejects.toBeInstanceOf(VercelApiError);
    expect(calls).toHaveLength(1);
  });
});

describe('usesVercelDns', () => {
  const base = fixture('domain').domain;
  it('needs Vercel service and every nameserver on Vercel', () => {
    expect(usesVercelDns(base)).toBe(true);
    expect(usesVercelDns({ ...base, serviceType: 'external' })).toBe(false);
    expect(usesVercelDns({ ...base, nameservers: ['ns1.vercel-dns.com', 'ns1.godaddy.com'] })).toBe(
      false,
    );
    expect(usesVercelDns({ ...base, nameservers: [] })).toBe(false);
  });
});
