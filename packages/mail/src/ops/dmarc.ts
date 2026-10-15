import { XMLParser } from 'fast-xml-parser';
import { gunzipSync, unzipSync } from 'fflate';
import { and, desc, dmarcReports, gte, type Db } from '@towncore/db';

// DMARC aggregate reports (RFC 7489 appendix C; docs/plans/MAIL.md, Mail-6). Receivers mail
// them to the rua address as .zip, .gz or plain XML. They are untrusted input: decompressed
// size is capped (zip bombs) and the XML parser expands no entities.

export const MAX_REPORT_BYTES = 20 * 1024 * 1024;

export type DmarcSource = {
  ip: string;
  count: number;
  disposition: string;
  dkim: string;
  spf: string;
  headerFrom: string | null;
};

export type DmarcReport = {
  orgName: string;
  reportId: string;
  domain: string;
  policy: string | null;
  beginAt: Date;
  endAt: Date;
  messages: number;
  dkimPass: number;
  spfPass: number;
  dmarcPass: number;
  sources: DmarcSource[];
};

export class DmarcParseError extends Error {}

const isGzip = (b: Uint8Array) => b.length > 18 && b[0] === 0x1f && b[1] === 0x8b;
const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;

/** The XML documents inside one attachment (zip, gzip or plain), or [] if it isn't a report. */
export function extractReportXml(filename: string, content: Uint8Array): string[] {
  if (isGzip(content)) {
    const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
    const declared = view.getUint32(content.length - 4, true);
    if (declared > MAX_REPORT_BYTES) throw new DmarcParseError(`${filename}: report too large`);
    return [new TextDecoder().decode(gunzipSync(content))];
  }
  if (isZip(content)) {
    const files = unzipSync(content, {
      filter: (f) => /\.xml$/i.test(f.name) && f.originalSize <= MAX_REPORT_BYTES,
    });
    return Object.values(files).map((f) => new TextDecoder().decode(f));
  }
  const text = new TextDecoder().decode(content.slice(0, 64)).trimStart();
  if (text.startsWith('<?xml') || text.startsWith('<feedback')) {
    if (content.length > MAX_REPORT_BYTES)
      throw new DmarcParseError(`${filename}: report too large`);
    return [new TextDecoder().decode(content)];
  }
  return [];
}

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  processEntities: false,
  isArray: (name) => name === 'record',
});

type Raw = Record<string, unknown>;
const str = (v: unknown) => (v == null ? '' : String(v).trim());
const num = (v: unknown) => {
  const n = Number(str(v));
  return Number.isFinite(n) ? n : 0;
};

export function parseDmarcXml(xml: string): DmarcReport {
  let doc: Raw;
  try {
    doc = parser.parse(xml) as Raw;
  } catch (error) {
    throw new DmarcParseError(`not XML: ${(error as Error).message}`);
  }
  const feedback = doc.feedback as Raw | undefined;
  const meta = feedback?.report_metadata as Raw | undefined;
  const published = feedback?.policy_published as Raw | undefined;
  const range = meta?.date_range as Raw | undefined;
  if (!feedback || !meta || !published || !range)
    throw new DmarcParseError(
      'not a DMARC aggregate report (missing feedback, metadata or policy)',
    );
  const records = (feedback.record as Raw[] | undefined) ?? [];
  const sources: DmarcSource[] = records.map((r) => {
    const row = (r.row as Raw | undefined) ?? {};
    const evaluated = (row.policy_evaluated as Raw | undefined) ?? {};
    const ids = (r.identifiers as Raw | undefined) ?? {};
    return {
      ip: str(row.source_ip),
      count: num(row.count),
      disposition: str(evaluated.disposition) || 'none',
      dkim: str(evaluated.dkim) || 'fail',
      spf: str(evaluated.spf) || 'fail',
      headerFrom: str(ids.header_from) || null,
    };
  });
  const sum = (f: (s: DmarcSource) => boolean) =>
    sources.filter(f).reduce((n, s) => n + s.count, 0);
  const orgName = str(meta.org_name);
  const reportId = str(meta.report_id);
  if (!orgName || !reportId) throw new DmarcParseError('report has no org_name or report_id');
  return {
    orgName,
    reportId,
    domain: str(published.domain).toLowerCase(),
    policy: str(published.p) || null,
    beginAt: new Date(num(range.begin) * 1000),
    endAt: new Date(num(range.end) * 1000),
    messages: sum(() => true),
    dkimPass: sum((s) => s.dkim === 'pass'),
    spfPass: sum((s) => s.spf === 'pass'),
    // DMARC passes when either aligned DKIM or aligned SPF passes.
    dmarcPass: sum((s) => s.dkim === 'pass' || s.spf === 'pass'),
    sources,
  };
}

/** Stores the reports in a message's attachments; a report seen before is skipped. */
export async function storeDmarcAttachments(
  db: Db,
  attachments: { filename: string; content: Uint8Array }[],
  now = new Date(),
): Promise<{ stored: number; duplicates: number; errors: string[] }> {
  const out = { stored: 0, duplicates: 0, errors: [] as string[] };
  for (const a of attachments) {
    let xmls: string[];
    try {
      xmls = extractReportXml(a.filename, a.content);
    } catch (error) {
      out.errors.push((error as Error).message);
      continue;
    }
    for (const xml of xmls) {
      try {
        const r = parseDmarcXml(xml);
        const rows = await db
          .insert(dmarcReports)
          .values({ ...r, receivedAt: now })
          .onConflictDoNothing()
          .returning({ id: dmarcReports.id });
        if (rows.length) out.stored++;
        else out.duplicates++;
      } catch (error) {
        out.errors.push(`${a.filename}: ${(error as Error).message}`);
      }
    }
  }
  return out;
}

export type DmarcSummary = {
  domain: string;
  reports: number;
  messages: number;
  dmarcPass: number;
  dkimPass: number;
  spfPass: number;
  /** Sources that failed both DKIM and SPF alignment, largest first. */
  failing: { ip: string; count: number; reporters: string[] }[];
};

/** The last 30 days per domain, for the health page. */
export async function dmarcSummary(db: Db, now = new Date(), days = 30): Promise<DmarcSummary[]> {
  const rows = await db
    .select()
    .from(dmarcReports)
    .where(and(gte(dmarcReports.endAt, new Date(now.getTime() - days * 86_400_000))))
    .orderBy(desc(dmarcReports.endAt));
  const by = new Map<
    string,
    DmarcSummary & { fails: Map<string, { count: number; reporters: Set<string> }> }
  >();
  for (const r of rows) {
    const s = by.get(r.domain) ?? {
      domain: r.domain,
      reports: 0,
      messages: 0,
      dmarcPass: 0,
      dkimPass: 0,
      spfPass: 0,
      failing: [],
      fails: new Map(),
    };
    s.reports++;
    s.messages += r.messages;
    s.dmarcPass += r.dmarcPass;
    s.dkimPass += r.dkimPass;
    s.spfPass += r.spfPass;
    for (const src of r.sources as DmarcSource[]) {
      if (src.dkim === 'pass' || src.spf === 'pass') continue;
      const f = s.fails.get(src.ip) ?? { count: 0, reporters: new Set<string>() };
      f.count += src.count;
      f.reporters.add(r.orgName);
      s.fails.set(src.ip, f);
    }
    by.set(r.domain, s);
  }
  return [...by.values()]
    .map(({ fails, ...s }) => ({
      ...s,
      failing: [...fails.entries()]
        .map(([ip, f]) => ({ ip, count: f.count, reporters: [...f.reporters].sort() }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}
