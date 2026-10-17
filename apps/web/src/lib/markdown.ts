import { micromark } from 'micromark';

// Article and page Markdown → HTML. micromark escapes raw HTML and drops dangerous link
// protocols (javascript:, data:) by default; we never turn those protections off.
//
// Two additions for code-built roundups (owner, 2026-10-17: "Roundups that read like articles"),
// each built here from escaped parts, never from raw HTML in the text:
// - pipe tables ("| a | b |" rows with a "| --- |" line), each in its own scrolling box so a
//   wide table never scrolls the page sideways on a phone;
// - collapsed blocks: ":::details Show all 101 filings" … ":::" become a closed <details> whose
//   summary is escaped text and whose content goes through this same renderer.

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const DETAILS_OPEN = /^:::details\s+(.+)$/;
const DETAILS_CLOSE = /^:::\s*$/;

/** One table cell's Markdown as inline HTML (micromark wraps it in a paragraph). */
const inline = (cell: string) =>
  micromark(cell.trim())
    .replace(/^<p>/, '')
    .replace(/<\/p>\n?$/, '');

/** Cells of a "| a | b |" row; "\|" stays inside a cell. */
function cells(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const out: string[] = [];
  let current = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === '|') {
      current += '\\|';
      i++;
    } else if (body[i] === '|') {
      out.push(current);
      current = '';
    } else current += body[i];
  }
  out.push(current);
  return out;
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isDivider = (line: string) => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(line);

/** A block that is a pipe table: a header row, a divider, then rows. */
export function isTable(block: string): boolean {
  const lines = block.split('\n');
  return lines.length >= 2 && isDivider(lines[1]!) && lines.every(isTableRow);
}

function renderTable(block: string): string {
  const [head, , ...rows] = block.split('\n');
  const th = cells(head!)
    .map((c) => `<th scope="col">${inline(c)}</th>`)
    .join('');
  const body = rows
    .map(
      (r) =>
        `<tr>${cells(r)
          .map((c) => `<td>${inline(c)}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  return `<div class="data-table" role="region" aria-label="Data table" tabindex="0"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Markdown → HTML, block by block, so tables and collapsed blocks get their own handling. */
export function renderMarkdown(markdown: string): string {
  const blocks = markdownBlocks(markdown);
  // Plain Markdown (no tables or collapsed blocks) renders in one pass, exactly as before.
  if (!blocks.some((b) => isTable(b) || DETAILS_OPEN.test(b.split('\n')[0]!))) {
    return micromark(markdown);
  }
  return blocks.map(renderBlock).join('\n');
}

function renderBlock(block: string): string {
  const lines = block.split('\n');
  const open = DETAILS_OPEN.exec(lines[0]!);
  if (open && lines.length >= 2 && DETAILS_CLOSE.test(lines.at(-1)!)) {
    const inner = lines.slice(1, -1).join('\n');
    return `<details class="data-more"><summary>${escapeHtml(open[1]!.trim())}</summary>${renderMarkdown(inner)}</details>`;
  }
  return isTable(block) ? renderTable(block) : micromark(block);
}

/**
 * Splits Markdown into top-level blocks (separated by blank lines) so slots can be placed
 * between paragraphs. Fenced code blocks and ":::details" blocks are kept whole, and a table
 * that follows a ":::details" line starts its own block.
 */
export function markdownBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  let inDetails = false;
  const flush = () => {
    if (current.length) blocks.push(current.join('\n'));
    current = [];
  };
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && !inDetails && DETAILS_OPEN.test(line)) {
      flush();
      inDetails = true;
      current.push(line);
      continue;
    }
    if (inDetails) {
      current.push(line);
      if (DETAILS_CLOSE.test(line)) {
        inDetails = false;
        flush();
      }
      continue;
    }
    if (!inFence && line.trim() === '') flush();
    else current.push(line);
  }
  flush();
  return blocks;
}

/** Plain paragraphs (not headings, lists, quotes, fences, tables or collapsed blocks). */
export function isParagraph(block: string): boolean {
  return !/^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\||:::)/.test(block);
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
