import * as cheerio from 'cheerio';
import type { RawRecord, SourceAdapter, SourceConfig } from '../types';

// Official reference pages for evergreen guides (CLAUDE.md §6a; docs/plans/M4.md §5). One
// source per guide topic, listing its pages: each run fetches every page through the polite
// fetcher (robots.txt, Crawl-delay, rate limit) and stores its main text as a `page` record.
// Ingest notices when the text changes, which is what refreshes the guide.
// Source config: { topic: string, pages: string[] }.

type Options = { topic: string; pages: string[] };

function options(source: SourceConfig): Options {
  const { topic, pages } = source.config as Partial<Options>;
  if (!topic || !Array.isArray(pages) || pages.length === 0) {
    throw new Error(`Page source ${source.id} needs config.topic and config.pages`);
  }
  return { topic, pages };
}

/**
 * Where a page's own content lives, most specific first: CivicPlus (#moduleContent), then the
 * usual landmarks. The whole body is the last resort.
 */
const CONTENT_SELECTORS = ['#moduleContent', 'main', '[role="main"]', 'article', '#content'];
/** Site chrome and widgets that are never part of what the page says. */
const CHROME =
  'script, style, noscript, template, svg, iframe, form, nav, header, footer, aside, button, [role="navigation"], [aria-hidden="true"], .breadcrumb, .breadcrumbs';
const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, div, section, tr, dd, dt, blockquote';

/** A page's title and main text, as plain lines. Headings and list items keep their own line. */
export function extractPage(html: string): { title: string | null; text: string } {
  const $ = cheerio.load(html);
  const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim();
  // "Bulk Waste | Boca Raton, FL" → "Bulk Waste"
  const docTitle = $('title').first().text().split('|')[0]!.replace(/\s+/g, ' ').trim();
  const root = CONTENT_SELECTORS.map((s) => $(s).first()).find((el) => el.length > 0) ?? $('body');
  root.find(CHROME).remove();
  root.find('br').replaceWith('\n');
  root.find('h1, h2, h3, h4, h5, h6').each((_, el) => {
    $(el).prepend('\n## ');
  });
  root.find('li').each((_, el) => {
    $(el).prepend('\n- ');
  });
  root.find(BLOCKS).each((_, el) => {
    $(el).append('\n');
  });
  root.find('td, th').each((_, el) => {
    $(el).append(' | ');
  });
  const lines = root
    .text()
    .split('\n')
    .map((line) =>
      line
        .replace(/\s+/g, ' ')
        .replace(/(\s*\|\s*)+$/, '')
        .trim(),
    )
    .filter((line) => line && line !== '##' && line !== '-');
  // Drop immediate repeats (CivicPlus repeats a widget's title as its heading).
  const text = lines.filter((line, i) => line !== lines[i - 1]).join('\n');
  return { title: h1 || docTitle || null, text };
}

/** Pages shorter than this carry no guide material (a link list, an error page). */
const MIN_TEXT = 200;

async function fetchPages(source: SourceConfig, ctx: Parameters<SourceAdapter['fetch']>[2]) {
  const { topic, pages } = options(source);
  const records: RawRecord[] = [];
  for (const url of pages) {
    // Every page must be fetched: a missing one fails the run, so the source's health and
    // "last checked" date never claim a guide was checked when part of it wasn't.
    const { title, text } = extractPage(await ctx.fetcher.getText(url));
    if (text.length < MIN_TEXT) {
      throw new Error(`${url} has only ${text.length} characters of text`);
    }
    records.push({
      externalId: `page:${url}`,
      type: 'page',
      title,
      text,
      url,
      occurredAt: null,
      raw: { topic },
    });
  }
  return records;
}

export const pageAdapter: SourceAdapter = {
  platform: 'page',
  kinds: ['reference'],
  // Any page can be a reference page; the launcher picks them, never detection.
  async detect() {
    return 0;
  },
  async fetch(source, _since, ctx) {
    return fetchPages(source, ctx);
  },
  async healthCheck(source, ctx) {
    try {
      const records = await fetchPages(source, ctx);
      return { ok: true, detail: `${records.length} pages` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  },
};
