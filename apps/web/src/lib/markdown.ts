import { micromark } from 'micromark';

// Article and page Markdown → HTML. micromark escapes raw HTML and drops dangerous link
// protocols (javascript:, data:) by default; we never turn those protections off.
export function renderMarkdown(markdown: string): string {
  return micromark(markdown);
}

/**
 * Splits Markdown into top-level blocks (separated by blank lines) so slots can be placed
 * between paragraphs. Fenced code blocks are kept whole.
 */
export function markdownBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === '') {
      if (current.length) blocks.push(current.join('\n'));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join('\n'));
  return blocks;
}

/** Plain paragraphs (not headings, lists, quotes or fences); used to count slot positions. */
export function isParagraph(block: string): boolean {
  return !/^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\|)/.test(block);
}

/**
 * article.inline positions (CLAUDE.md §11b): after paragraph 3, then every ~6 paragraphs;
 * only one on short articles. Returns block indexes to place a slot after.
 */
export function inlineSlotPositions(blocks: string[]): number[] {
  const paragraphIndexes = blocks.map((b, i) => (isParagraph(b) ? i : -1)).filter((i) => i >= 0);
  if (paragraphIndexes.length <= 3) return [];
  const short = paragraphIndexes.length < 10;
  const positions: number[] = [];
  for (let n = 3; n < paragraphIndexes.length; n += 6) {
    positions.push(paragraphIndexes[n - 1]!);
    if (short) break;
  }
  return positions;
}
