import { describe, expect, it } from 'vitest';
import { inlineSlotPositions, markdownBlocks, renderMarkdown } from '../src/lib/markdown';

describe('renderMarkdown', () => {
  it('escapes raw HTML and drops dangerous links', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1))');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
  });

  it('renders ordinary Markdown', () => {
    expect(renderMarkdown('Hello **world**')).toBe('<p>Hello <strong>world</strong></p>');
  });

  it('renders roundup tables in their own scrolling box, escaping every cell', () => {
    const html = renderMarkdown(
      [
        'Lede.',
        '',
        '| Business | ZIP |',
        '| --- | --- |',
        '| A \\| B <script>x</script> | [33431](https://x.gov/a) |',
        '| **C** | 33432 |',
      ].join('\n'),
    );
    expect(html).toContain('<p>Lede.</p>');
    expect(html).toContain('<div class="data-table" role="region"');
    expect(html).toContain('<th scope="col">Business</th>');
    expect(html).toContain('<td>A | B &lt;script&gt;x&lt;/script&gt;</td>');
    expect(html).toContain('<a href="https://x.gov/a">33431</a>');
    expect(html).toContain('<td><strong>C</strong></td>');
    expect(html).not.toContain('<script>');
  });

  it('renders ":::details" blocks closed, with an escaped summary', () => {
    const md = [
      '| A |',
      '| --- |',
      '| 1 |',
      ':::details Show all <b>3</b> rows',
      '| A |',
      '| --- |',
      '| 2 |',
      '| 3 |',
      ':::',
      '',
      'After.',
    ].join('\n');
    const blocks = markdownBlocks(md);
    expect(blocks).toHaveLength(3);
    const html = renderMarkdown(md);
    expect(html).toMatch(
      /<details class="data-more"><summary>Show all &lt;b&gt;3&lt;\/b&gt; rows<\/summary><div class="data-table"/,
    );
    expect(html).not.toContain('<details class="data-more" open');
    expect(html.match(/<tr>/g)).toHaveLength(5);
    expect(html).toContain('<p>After.</p>');
    // Tables and collapsed blocks never count as paragraphs for ad slots.
    expect(inlineSlotPositions(blocks)).toEqual([]);
  });
});

describe('markdownBlocks and inline slot positions', () => {
  const paragraphs = (n: number) =>
    Array.from({ length: n }, (_, i) => `Paragraph ${i + 1}.`).join('\n\n');

  it('keeps fenced code blocks whole', () => {
    expect(markdownBlocks('a\n\n```\nx\n\ny\n```\n\nb')).toHaveLength(3);
  });

  it('places nothing in articles of 3 paragraphs or fewer', () => {
    expect(inlineSlotPositions(markdownBlocks(paragraphs(3)))).toEqual([]);
  });

  it('places one slot after paragraph 3 in short articles', () => {
    expect(inlineSlotPositions(markdownBlocks(paragraphs(8)))).toEqual([2]);
  });

  it('places slots after paragraph 3, then every 6, in long articles', () => {
    expect(inlineSlotPositions(markdownBlocks(paragraphs(16)))).toEqual([2, 8, 14]);
  });

  it('counts only paragraphs, not headings or lists', () => {
    const md = ['## Heading', 'P1', '- item', 'P2', 'P3', 'P4'].join('\n\n');
    expect(inlineSlotPositions(markdownBlocks(md))).toEqual([4]);
  });
});
