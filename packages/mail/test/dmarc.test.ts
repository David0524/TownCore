import {
  dmarcReports,
  mailDomains,
  messages,
  syncMailRouting,
  type Db,
  loadRoutingTable,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { gzipSync, strToU8, zipSync } from 'fflate';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processReceivedNotification, type ProcessDeps } from '../src/inbound/process';
import type { MailObjectStore } from '../src';
import {
  DmarcParseError,
  dmarcSummary,
  extractReportXml,
  parseDmarcXml,
  storeDmarcAttachments,
} from '../src/ops/dmarc';

// A report in the RFC 7489 appendix C format, as Google and others send it.
const report = (
  id: string,
  records: { ip: string; count: number; dkim: string; spf: string }[],
) => `<?xml version="1.0" encoding="UTF-8" ?>
<feedback>
  <report_metadata>
    <org_name>google.com</org_name>
    <email>noreply-dmarc-support@google.com</email>
    <report_id>${id}</report_id>
    <date_range><begin>1792022400</begin><end>1792108799</end></date_range>
  </report_metadata>
  <policy_published><domain>BocaTownSquare.com</domain><adkim>r</adkim><aspf>r</aspf><p>none</p><pct>100</pct></policy_published>
  ${records
    .map(
      (r) => `<record>
    <row><source_ip>${r.ip}</source_ip><count>${r.count}</count>
      <policy_evaluated><disposition>none</disposition><dkim>${r.dkim}</dkim><spf>${r.spf}</spf></policy_evaluated></row>
    <identifiers><header_from>bocatownsquare.com</header_from></identifiers>
    <auth_results><dkim><domain>bocatownsquare.com</domain><result>${r.dkim}</result></dkim></auth_results>
  </record>`,
    )
    .join('\n')}
</feedback>`;

const sample = report('12345678901234567890', [
  { ip: '54.240.8.1', count: 90, dkim: 'pass', spf: 'pass' },
  { ip: '54.240.8.2', count: 8, dkim: 'pass', spf: 'fail' },
  { ip: '203.0.113.9', count: 2, dkim: 'fail', spf: 'fail' },
]);

describe('parsing reports', () => {
  it('reads the summary and keeps report ids as text', () => {
    const r = parseDmarcXml(sample);
    expect(r).toMatchObject({
      orgName: 'google.com',
      reportId: '12345678901234567890',
      domain: 'bocatownsquare.com',
      policy: 'none',
      messages: 100,
      dkimPass: 98,
      spfPass: 90,
      dmarcPass: 98,
    });
    expect(r.beginAt.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(r.sources).toHaveLength(3);
  });

  it('opens zip, gzip and plain attachments, and ignores anything else', () => {
    const xml = strToU8(sample);
    expect(
      extractReportXml(
        'google.com!boca.zip',
        zipSync({ 'google.com!boca.xml': xml, 'readme.txt': strToU8('x') }),
      ),
    ).toEqual([sample]);
    expect(extractReportXml('report.xml.gz', gzipSync(xml))).toEqual([sample]);
    expect(extractReportXml('report.xml', xml)).toEqual([sample]);
    expect(extractReportXml('logo.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toEqual([]);
  });

  it('refuses oversized gzip and non-reports', () => {
    const fake = gzipSync(strToU8('<feedback/>'));
    new DataView(fake.buffer).setUint32(fake.length - 4, 500 * 1024 * 1024, true);
    expect(() => extractReportXml('big.gz', fake)).toThrow(/too large/);
    expect(() => parseDmarcXml('<html><body>hi</body></html>')).toThrow(DmarcParseError);
  });
});

describe('storing reports', () => {
  let db: Db;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    await syncMailRouting(db);
    await db.insert(mailDomains).values({
      name: 'bocatownsquare.com',
      displayName: 'Boca',
      status: 'live',
      inboundEnabled: true,
    });
  });
  afterAll(async () => drop?.());

  it('stores once and summarizes the last 30 days with failing sources', async () => {
    const first = await storeDmarcAttachments(db, [
      { filename: 'a.xml.gz', content: gzipSync(strToU8(sample)) },
    ]);
    expect(first).toEqual({ stored: 1, duplicates: 0, errors: [] });
    const again = await storeDmarcAttachments(db, [
      { filename: 'a.xml.gz', content: gzipSync(strToU8(sample)) },
    ]);
    expect(again).toEqual({ stored: 0, duplicates: 1, errors: [] });
    const [summary] = await dmarcSummary(db, new Date('2026-10-20T00:00:00Z'));
    expect(summary).toMatchObject({
      domain: 'bocatownsquare.com',
      reports: 1,
      messages: 100,
      dmarcPass: 98,
    });
    expect(summary!.failing).toEqual([{ ip: '203.0.113.9', count: 2, reporters: ['google.com'] }]);
    expect(await dmarcSummary(db, new Date('2026-12-30T00:00:00Z'))).toEqual([]);
  });

  it('mail to the report address becomes reports, not inbox threads', async () => {
    const raw = await new Promise<Buffer>((resolve, reject) =>
      new MailComposer({
        from: 'noreply-dmarc-support@google.com',
        to: 'dmarc@bocatownsquare.com',
        subject: 'Report domain: bocatownsquare.com Submitter: google.com',
        text: 'This is an aggregate report.',
        attachments: [
          {
            filename: 'google.com!bocatownsquare.com!1.zip',
            content: Buffer.from(
              zipSync({
                'r.xml': strToU8(
                  report('999', [{ ip: '1.2.3.4', count: 5, dkim: 'pass', spf: 'pass' }]),
                ),
              }),
            ),
          },
        ],
      })
        .compile()
        .build((e, m) => (e ? reject(e) : resolve(m))),
    );
    const objects: MailObjectStore = {
      async getRaw() {
        return raw;
      },
      async putAttachment() {},
    };
    const deps: ProcessDeps = {
      db,
      objects,
      bucket: 'b',
      routing: await loadRoutingTable(db),
      dmarcAddress: 'DMARC@bocatownsquare.com',
    };
    const result = await processReceivedNotification(
      {
        notificationType: 'Received',
        mail: {
          messageId: 'ses-dmarc-1',
          source: 'noreply-dmarc-support@google.com',
          timestamp: '2026-10-15T12:00:00Z',
        },
        receipt: {
          recipients: ['dmarc@bocatownsquare.com'],
          spamVerdict: { status: 'PASS' },
          virusVerdict: { status: 'PASS' },
          spfVerdict: { status: 'PASS' },
          dkimVerdict: { status: 'PASS' },
          dmarcVerdict: { status: 'PASS' },
          action: {
            type: 'S3',
            bucketName: 'b',
            objectKey: 'inbound/ses-dmarc-1',
            topicArn: 'arn:x',
          },
        },
      },
      deps,
    );
    expect(result).toMatchObject({ outcome: 'stored', stored: 0, dmarcReports: 1 });
    expect(await db.select().from(messages)).toHaveLength(0);
    expect((await db.select().from(dmarcReports)).map((r) => r.reportId).sort()).toEqual([
      '12345678901234567890',
      '999',
    ]);
  });
});
