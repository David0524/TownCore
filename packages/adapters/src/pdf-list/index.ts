import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { extractText, getDocumentProxy } from 'unpdf';
import type { AdapterContext, RawRecord, SourceAdapter, SourceConfig } from '../types';

// Lists published as a PDF on a schedule, linked from an index page (CLAUDE.md §9): a county's
// weekly road and bridge construction list, a district's closures, a board's agenda packet list.
// The adapter finds the newest PDF whose link matches, extracts its text in JavaScript (no system
// tools on the worker), splits it into numbered entries ("12. LOCATION: …") and keeps the ones
// tagged for this town. Each issue's entries are their own records, so a weekly roundup can say
// what's new since the last issue; a project's key (its location and work) stays the same across
// issues.
//
// Source: url = the index page (https://discover.pbc.gov/Pages/Roads.aspx).
// Config:
//   link: 'Road and Bridge Construction List' — text the PDF's link or file name contains
//   match: '(City of Boca Raton)'            — text an entry must contain to be this town's
//   fields: ['LOCATION', 'DESCRIPTION', 'RESTRICTION'] — labeled parts of an entry (first = title)
//   issued: 'DATE OF ISSUE'                  — the label of the issue date line
//   type: 'road-work'                        — record type

type Options = {
  link: string;
  match: string;
  fields: string[];
  issued: string;
  type: string;
};

function options(source: SourceConfig): Options {
  const c = source.config as Record<string, unknown>;
  const str = (k: string, fallback?: string) =>
    typeof c[k] === 'string' && c[k] ? (c[k] as string) : fallback;
  const link = str('link');
  const match = str('match');
  if (!source.url || !link || !match)
    throw new Error(`pdf-list source ${source.id} needs url, config.link and config.match`);
  const fields =
    Array.isArray(c.fields) && c.fields.length
      ? c.fields.map(String)
      : ['LOCATION', 'DESCRIPTION', 'RESTRICTION'];
  return {
    link,
    match,
    fields,
    issued: str('issued', 'DATE OF ISSUE')!,
    type: str('type', 'pdf-entry')!,
  };
}

/** The newest matching PDF linked from the index page (the first one listed). */
export function findPdfLink(html: string, pageUrl: string, link: string): string | null {
  const $ = cheerio.load(html);
  const want = link.toLowerCase();
  for (const a of $('a[href]').toArray()) {
    const href = $(a).attr('href')!;
    if (!/\.pdf(\?|$)/i.test(href)) continue;
    const label = `${$(a).text()} ${decodeURIComponent(href)}`.toLowerCase().replace(/[-_]/g, ' ');
    if (label.includes(want.replace(/[-_]/g, ' '))) return new URL(href, pageUrl).toString();
  }
  return null;
}

export type PdfEntry = { number: number; parts: Record<string, string>; section: string | null };

/** Splits a list's text into numbered entries with their labeled parts. */
export function parseEntries(text: string, fields: string[]): PdfEntry[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^Page \d+ of \d+$/i.test(l));
  const first = fields[0]!;
  const start = new RegExp(`^(\\d+)\\.\\s+${first}:\\s*(.*)$`, 'i');
  const label = new RegExp(`^(${fields.join('|')}):\\s*(.*)$`, 'i');
  const entries: PdfEntry[] = [];
  let section: string | null = null;
  let current: PdfEntry | null = null;
  let field = first;
  for (const line of lines) {
    const heading = /^\*{3}\s*(.+?)\s*\*{3}$/.exec(line);
    if (heading) {
      section = heading[1]!;
      current = null;
      continue;
    }
    const begin = start.exec(line);
    if (begin) {
      current = { number: Number(begin[1]), parts: { [first]: begin[2]! }, section };
      field = first;
      entries.push(current);
      continue;
    }
    if (!current) continue;
    const part = label.exec(line);
    if (part) {
      field = part[1]!.toUpperCase();
      current.parts[field] = part[2]!;
    } else {
      current.parts[field] = `${current.parts[field] ?? ''} ${line}`.trim();
    }
  }
  return entries;
}

/** "DATE OF ISSUE: October 16, 2026" → Date (UTC noon), or null. */
export function issueDate(text: string, label: string): Date | null {
  const m = new RegExp(`${label}:\\s*([A-Za-z]+ \\d{1,2}, \\d{4})`, 'i').exec(text);
  const d = m ? new Date(`${m[1]} 12:00 UTC`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/** Location text without its jurisdiction and district tags: "Military Trl. and Clint Moore Rd.". */
const cleanTitle = (s: string) =>
  s
    .replace(
      /\((?:City|Town|Village) of [^)]+\)|\(Districts? [^)]+\)|\(Unincorporated[^)]*\)/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();

export function pdfListRecords(
  text: string,
  pdfUrl: string,
  opts: Options,
): { issued: Date | null; records: RawRecord[] } {
  const issued = issueDate(text, opts.issued);
  const day = issued?.toISOString().slice(0, 10) ?? 'undated';
  // "STATUS FOR October 19, 2026 thru October 25, 2026": the days the list covers, if it says.
  const covers =
    /STATUS FOR\s+([A-Za-z]+ \d{1,2}, \d{4})\s+(?:thru|through|to|-)\s+([A-Za-z]+ \d{1,2}, \d{4})/i.exec(
      text,
    );
  const want = opts.match.toLowerCase();
  const byId = new Map<string, RawRecord>();
  const records = parseEntries(text, opts.fields)
    .filter((e) => Object.values(e.parts).join(' ').toLowerCase().includes(want))
    .map((e) => {
      const title = cleanTitle(e.parts[opts.fields[0]!] ?? '');
      const project = createHash('sha256')
        .update(`${title}|${e.parts[opts.fields[1] ?? ''] ?? ''}`.toLowerCase())
        .digest('hex')
        .slice(0, 16);
      return {
        externalId: `${day}:${project}`,
        type: opts.type,
        title,
        text: opts.fields
          .filter((f) => e.parts[f])
          .map((f) => `${f[0]}${f.slice(1).toLowerCase()}: ${e.parts[f]}`)
          .join('\n'),
        url: pdfUrl,
        occurredAt: issued,
        raw: {
          project,
          issued: day,
          ...(covers ? { from: covers[1], to: covers[2] } : {}),
          number: e.number,
          section: e.section,
          ...e.parts,
        },
      };
    })
    // A list can name one project twice (the same place and work, under two entries): keep one
    // record, adding the second entry's other details to the first's.
    .filter((r) => {
      const seen = byId.get(r.externalId);
      if (!seen) return (byId.set(r.externalId, r), true);
      const into = seen.raw as Record<string, unknown>;
      for (const f of opts.fields.slice(2)) {
        const more = (r.raw as unknown as Record<string, string>)[f];
        const had = String(into[f] ?? '');
        if (more && !had.includes(more)) into[f] = had ? `${had} ${more}` : more;
      }
      seen.text = opts.fields
        .filter((f) => into[f])
        .map((f) => `${f[0]}${f.slice(1).toLowerCase()}: ${String(into[f])}`)
        .join('\n');
      return false;
    });
  return { issued, records };
}

async function latestPdf(source: SourceConfig, opts: Options, ctx: AdapterContext) {
  const page = await ctx.fetcher.get(source.url!);
  if (!page.ok) throw new Error(`GET ${source.url} failed: HTTP ${page.status}`);
  const pdfUrl = findPdfLink(await page.text(), source.url!, opts.link);
  if (!pdfUrl) throw new Error(`No PDF link containing "${opts.link}" on ${source.url}`);
  return pdfUrl;
}

export const pdfListAdapter: SourceAdapter = {
  platform: 'pdf-list',
  kinds: ['roads', 'agenda', 'city_news'],

  async detect() {
    return 0;
  },

  async fetch(source, _since, ctx) {
    const opts = options(source);
    const pdfUrl = await latestPdf(source, opts, ctx);
    const response = await ctx.fetcher.get(pdfUrl);
    if (!response.ok) throw new Error(`GET ${pdfUrl} failed: HTTP ${response.status}`);
    const pdf = await getDocumentProxy(new Uint8Array(await response.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: true });
    return pdfListRecords(String(text), pdfUrl, opts).records;
  },

  async healthCheck(source, ctx) {
    try {
      await latestPdf(source, options(source), ctx);
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  },
};
