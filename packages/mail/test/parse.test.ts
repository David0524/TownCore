import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRawEmail } from '../src/inbound/parse';
import { sanitizeEmailHtml } from '../src/inbound/sanitize';
import { normalizeSubject, referencedIds } from '../src/inbound/threading';

const eml = (name: string) => readFileSync(new URL(`../fixtures/eml/${name}.eml`, import.meta.url));

describe('parseRawEmail', () => {
  it('parses multipart/alternative and sanitizes the HTML', async () => {
    const m = await parseRawEmail(eml('multipart-alternative'));
    expect(m).toMatchObject({
      rfcMessageId: 'abc123@mail.example.com',
      from: { address: 'pat.reader@example.com', name: 'Pat Reader' },
      to: ['sales@testtown.com'],
      subject: 'Advertising question',
      isAutomated: false,
      attachments: [],
    });
    expect(m.text).toContain('how much is a sponsored slot');
    const html = m.htmlSanitized!;
    expect(html).toContain('<b>sponsored slot</b>');
    expect(html).toContain('style="color:blue"');
    for (const bad of [
      '<script',
      'alert(1)',
      'onclick',
      '<style',
      'javascript:',
      '<form',
      '<input',
      '<iframe',
      'data:text/html',
    ])
      expect(html).not.toContain(bad);
    // Remote images survive sanitizing; the viewer blocks them until asked (Mail-3).
    expect(html).toContain('https://tracker.example.com/pixel.gif');
    expect(html).toContain(
      'href="https://example.com/rates" target="_blank" rel="noopener noreferrer nofollow"',
    );
  });

  it('keeps inline images and attachments, with content ids', async () => {
    const m = await parseRawEmail(eml('inline-and-attachment'));
    expect(m.cc).toEqual(['editor@testtown.com', 'someone@example.org']);
    expect(m.htmlSanitized).toContain('src="cid:img1@example.org"');
    expect(m.attachments.map(({ content, ...a }) => ({ ...a, bytes: content.length > 0 }))).toEqual(
      [
        {
          position: 0,
          filename: 'flood.png',
          contentType: 'image/png',
          size: m.attachments[0]!.size,
          contentId: 'img1@example.org',
          inline: true,
          bytes: true,
        },
        {
          position: 1,
          filename: 'permit.pdf',
          contentType: 'application/pdf',
          size: m.attachments[1]!.size,
          contentId: null,
          inline: false,
          bytes: true,
        },
      ],
    );
    expect(m.attachments[1]!.content.toString()).toContain('%PDF-1.4');
  });

  it('decodes encoded-word headers and base64 bodies in other charsets', async () => {
    const m = await parseRawEmail(eml('odd-encodings'));
    expect(m.from).toEqual({ address: 'jose@example.es', name: 'José Pérez' });
    expect(m.subject).toBe('Café reopening ☕');
    expect(m.text).toContain('El café de la calle 5 reabre el lunes. 👍');
  });

  it('copes with missing Message-ID, Subject and Date', async () => {
    const m = await parseRawEmail(eml('missing-headers'));
    expect(m).toMatchObject({
      rfcMessageId: null,
      subject: '',
      date: null,
      htmlSanitized: null,
      inReplyTo: null,
      references: [],
    });
    expect(m.text).toContain('just a body');
  });

  it('reads reply headers', async () => {
    const m = await parseRawEmail(eml('reply'));
    expect(m.inReplyTo).toBe('out-1@testtown.com');
    expect(m.references).toEqual(['abc123@mail.example.com', 'out-1@testtown.com']);
    expect(referencedIds(m)).toEqual(['out-1@testtown.com', 'abc123@mail.example.com']);
  });

  it('flags auto-replies (loop protection)', async () => {
    expect((await parseRawEmail(eml('auto-reply'))).isAutomated).toBe(true);
    const precedence = 'From: a@b.com\r\nTo: sales@testtown.com\r\nPrecedence: bulk\r\n\r\nx';
    expect((await parseRawEmail(precedence)).isAutomated).toBe(true);
    const no = 'From: a@b.com\r\nTo: sales@testtown.com\r\nAuto-Submitted: no\r\n\r\nx';
    expect((await parseRawEmail(no)).isAutomated).toBe(false);
  });
});

describe('sanitizeEmailHtml', () => {
  it('drops event handlers, scripts and javascript: links but keeps formatting', () => {
    expect(
      sanitizeEmailHtml(
        '<table border="1"><tr><td colspan="2" onmouseover="x()">a</td></tr></table>',
      ),
    ).toBe('<table border="1"><tr><td colspan="2">a</td></tr></table>');
    expect(sanitizeEmailHtml('<a href="JaVaScRiPt:alert(1)">x</a>')).not.toMatch(/javascript/i);
    expect(sanitizeEmailHtml('<img src="data:image/png;base64,AAAA">')).toContain('data:image/png');
    expect(sanitizeEmailHtml('<svg onload="x()"><script>1</script></svg>ok')).toBe('ok');
  });
});

describe('normalizeSubject', () => {
  it.each([
    ['RE: Fwd: Re: Advertising question', 'advertising question'],
    ['Re[2]: AW: SV:  Hello   there', 'hello there'],
    ['Fw: [EXT] Notice', '[ext] notice'],
    ['Return policy', 'return policy'],
    ['', ''],
  ])('%j → %j', (input, expected) => expect(normalizeSubject(input)).toBe(expected));
});
