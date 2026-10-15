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
