import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Fetcher, type FetchFn } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import { extractPage, pageAdapter } from '../src/page';
import type { SourceConfig } from '../src/types';

// Official reference pages for evergreen guides (M4 PR F). Recorded live on 2026-10-16 from
// www.myboca.us (CivicPlus), pbcpao.gov and www.pbctax.gov.
const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/page/${name}.json`, import.meta.url));
const fetcherFor = (fetchImpl: FetchFn) =>
  new Fetcher({ fetchImpl, sleep: async () => {}, now: () => 0, minIntervalMs: 0 });
const ctx = (name: string) => ({
  fetcher: fetcherFor(replayFetch(fixture(name))),
  now: new Date('2026-10-16T12:00:00Z'),
});
const source = (topic: string, pages: string[]): SourceConfig => ({
  id: 'guide',
  townId: 't',
  kind: 'reference',
  platform: 'page',
  url: pages[0]!,
  config: { topic, pages },
});

describe('page adapter', () => {
  it('stores each page’s title and main text, without the site’s navigation or footer', async () => {
    const records = await pageAdapter.fetch(
      source('trash-pickup', [
        'https://www.myboca.us/680/Garbage-Collection-Containers',
        'https://www.myboca.us/665/Sanitation',
      ]),
      null,
      ctx('boca-trash'),
    );
    expect(records.map((r) => [r.externalId, r.type, r.title])).toEqual([
      [
        'page:https://www.myboca.us/680/Garbage-Collection-Containers',
        'page',
        'Garbage Collection & Containers',
      ],
      ['page:https://www.myboca.us/665/Sanitation', 'page', 'Sanitation Services'],
    ]);
    const [garbage] = records;
    expect(garbage!.text).toContain('Garbage is collected twice a week.');
    expect(garbage!.raw).toEqual({ topic: 'trash-pickup' });
    expect(garbage!.occurredAt).toBeNull();
    // CivicPlus chrome stays out: the menu, the site search and the footer's address block.
    expect(garbage!.text).not.toMatch(/Website Sign In|Create a Website Account|Site Map/);
  });

  it('keeps headings and list items on their own lines on other sites too', async () => {
    const [homestead, tax] = await pageAdapter.fetch(
      source('property-tax', [
        'https://pbcpao.gov/homestead-exemption.htm',
        'https://www.pbctax.gov/taxes/property-tax/',
      ]),
      null,
      ctx('palm-beach-property-tax'),
    );
    expect(homestead!.title).toBe('The Homestead Exemption');
    expect(homestead!.text).toContain('\n## Qualifications\n');
    expect(homestead!.text).toContain('\n- Be a permanent resident of the State of Florida\n');
    expect(tax!.text).toContain('Property taxes are payable November 1 to March 31 each year.');
  });

  it('fails the whole run when any page is missing or empty, so nothing claims it was checked', async () => {
    const fetchImpl: FetchFn = async (url) => {
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      if (url.endsWith('/gone')) return new Response('Not found', { status: 404 });
      if (url.endsWith('/empty')) return new Response('<html><body><main>Hi</main></body></html>');
      return new Response(
        `<html><body><main><p>${'Useful text. '.repeat(30)}</p></main></body></html>`,
      );
    };
    const run = (pages: string[]) =>
      pageAdapter.fetch(source('t', pages), null, {
        fetcher: fetcherFor(fetchImpl),
        now: new Date(),
      });
    await expect(run(['https://city.example/ok'])).resolves.toHaveLength(1);
    await expect(run(['https://city.example/ok', 'https://city.example/gone'])).rejects.toThrow(
      /HTTP 404/,
    );
    await expect(run(['https://city.example/empty'])).rejects.toThrow(/only 2 characters/);
  });

  it('respects robots.txt like every adapter', async () => {
    const fetchImpl: FetchFn = async (url) =>
      url.endsWith('/robots.txt')
        ? new Response('User-agent: *\nDisallow: /private\n')
        : new Response('<main>never</main>');
    await expect(
      pageAdapter.fetch(source('t', ['https://city.example/private/page']), null, {
        fetcher: fetcherFor(fetchImpl),
        now: new Date(),
      }),
    ).rejects.toThrow(/robots\.txt/);
  });

  it('needs a topic and at least one page', async () => {
    await expect(
      pageAdapter.fetch(
        { ...source('t', []), config: { topic: 't', pages: [] } },
        null,
        ctx('boca-trash'),
      ),
    ).rejects.toThrow(/config\.topic and config\.pages/);
  });
});

describe('extractPage', () => {
  it('prefers the page’s own content area and drops repeated lines', () => {
    const html = `<html><head><title>Bulk Waste | Boca Raton, FL</title></head><body>
      <nav><a href="/">Home</a></nav>
      <div id="moduleContent"><h1>Bulk Waste</h1><h2>Bulk Waste</h2>
        <p>Bulk items are collected once a week.</p>
        <ul><li>Furniture</li><li>Bicycles</li></ul>
        <script>track()</script></div>
      <footer>201 West Palmetto Park Road</footer></body></html>`;
    expect(extractPage(html)).toEqual({
      title: 'Bulk Waste',
      text: '## Bulk Waste\nBulk items are collected once a week.\n- Furniture\n- Bicycles',
    });
  });

  it('falls back to the document title when there is no h1', () => {
    expect(extractPage('<title>Parking | City</title><main><p>Park here.</p></main>').title).toBe(
      'Parking',
    );
  });
});
