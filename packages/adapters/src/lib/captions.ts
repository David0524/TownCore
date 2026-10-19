// Meeting caption files (WebVTT, SRT, or plain text) read into timed cues. No dependency needed.
//
// Two uses: a staff member uploads the captions a town publishes for its own meeting video, or
// a meeting's own recording export (Zoom, Teams), and the text becomes that meeting's transcript
// record; and the meeting splitter maps a stretch of transcript text back to the second it was
// said. Never a way to fetch captions from a video site (D-M2-4: no caption scraping).
//
// Ported from the reader in Kyle's TownCore (lib/meetings/vtt.ts), with SRT, Swagit-style
// stamped text and roll-up captions added. It is forgiving on purpose: a block it can't read is
// skipped rather than failing the file, since a transcript with three bad cues is still worth
// the rest of the meeting.

export type Cue = {
  /** Whole seconds from the start of the recording. */
  start: number;
  /** Whole seconds, when the file gives an end time. */
  end: number | null;
  text: string;
};

export type CaptionFormat = 'vtt' | 'srt' | 'stamped' | 'text';

export type ParsedCaptions = {
  format: CaptionFormat;
  /** Empty for plain text with no timestamps. */
  cues: Cue[];
  /** The cue texts, one per line (or the cleaned plain text). */
  text: string;
  /** Where each cue starts in `text`, in characters: offsets[i] belongs to cues[i]. */
  offsets: number[];
};

/** "00:01:02.500", "01:02.500", "00:01:02,500" or "1:02:03" as whole seconds. */
export function timestampToSeconds(ts: string): number | null {
  const m = ts.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  return h * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Seconds as a clock: 75 → "1:15", 3723 → "1:02:03". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** One cue's lines as plain text: voice tags (<v Jane Doe>), other markup and SRT styling out. */
function cleanCueText(lines: string[]): string {
  return lines
    .join(' ')
    .replace(/<\/?v[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\\[^}]*\}/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .replace(/ ([.,;:!?])/g, '$1')
    .trim();
}

const normalize = (raw: string) => raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

/**
 * Adds a cue unless it repeats the last one. Roll-up captions (YouTube, many broadcast
 * encoders) repeat the previous line before the new words; only the new words are kept.
 */
function pushCue(cues: Cue[], cue: Cue) {
  const prev = cues[cues.length - 1];
  if (prev && prev.text === cue.text) return;
  if (prev && cue.text.startsWith(`${prev.text} `)) {
    cue = { ...cue, text: cue.text.slice(prev.text.length + 1).trim() };
    if (!cue.text) return;
  }
  cues.push(cue);
}

/**
 * Cue blocks separated by blank lines, each with a "start --> end" line (first or second, after
 * a cue number). The same reader serves WebVTT and SRT; headers, NOTE, STYLE and REGION blocks
 * have no timing line and are skipped.
 */
function parseTimedBlocks(raw: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of normalize(raw).split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trimEnd());
    const timing = lines.slice(0, 2).findIndex((l) => l.includes('-->'));
    if (timing === -1) continue;
    const [from, to] = lines[timing]!.split('-->');
    const start = timestampToSeconds(from ?? '');
    if (start === null) continue;
    // The end may carry VTT cue settings after it ("00:00:05.000 align:start").
    const end = timestampToSeconds((to ?? '').trim().split(/\s+/)[0] ?? '');
    const text = cleanCueText(lines.slice(timing + 1));
    if (!text) continue;
    pushCue(cues, { start, end, text });
  }
  return cues;
}

const STAMP_LINE = /^\[(\d{1,2}:\d{2}:\d{2})\]$/;

/**
 * Text with a "[00:05:48]" line now and then (Swagit's transcript layout): each stamp starts a
 * cue holding the lines that follow it. Text before the first stamp starts at 0.
 */
function parseStampedText(raw: string): Cue[] {
  const cues: Cue[] = [];
  let start = 0;
  let lines: string[] = [];
  const flush = () => {
    const text = lines.join('\n').trim();
    if (text) pushCue(cues, { start, end: null, text });
    lines = [];
  };
  for (const line of normalize(raw).split('\n')) {
    const tidy = line.replace(/\s+/g, ' ').trim();
    const stamp = tidy.match(STAMP_LINE);
    if (stamp) {
      flush();
      start = timestampToSeconds(stamp[1]!) ?? start;
    } else if (tidy) {
      lines.push(tidy);
    }
  }
  flush();
  return cues;
}

/** True when the text looks like WebVTT: its header, or a timing line with the arrow. */
export function looksLikeVtt(raw: string): boolean {
  const head = normalize(raw).slice(0, 2000);
  if (/^WEBVTT/.test(head.trimStart())) return true;
  return /\d{1,2}:\d{2}(?:[.,]\d{1,3})?\s*-->\s*\d/.test(head);
}

/** True when the text looks like SRT: a cue number, then a timing line with comma decimals. */
export function looksLikeSrt(raw: string): boolean {
  return /^\s*\d+\s*\n\s*\d{1,2}:\d{2}:\d{2},\d{1,3}\s*-->/.test(normalize(raw).slice(0, 2000));
}

function withOffsets(format: CaptionFormat, cues: Cue[]): ParsedCaptions {
  const offsets: number[] = [];
  let at = 0;
  for (const cue of cues) {
    offsets.push(at);
    at += cue.text.length + 1;
  }
  return { format, cues, text: cues.map((c) => c.text).join('\n'), offsets };
}

/**
 * Reads a caption file. The file name's extension decides when it's given (.vtt, .srt, .txt);
 * otherwise the content does. Plain text with no timestamps keeps its lines and has no cues.
 */
export function parseCaptions(raw: string, fileName?: string): ParsedCaptions {
  const ext = fileName?.toLowerCase().match(/\.(vtt|srt|txt)$/)?.[1];
  if (ext === 'vtt' || ext === 'srt' || (!ext && (looksLikeVtt(raw) || looksLikeSrt(raw)))) {
    const format: CaptionFormat =
      ext === 'srt' || (!ext && looksLikeSrt(raw) && !/^\s*WEBVTT/.test(normalize(raw)))
        ? 'srt'
        : 'vtt';
    return withOffsets(format, parseTimedBlocks(raw));
  }
  // A .txt export can still be a VTT or SRT body, or stamped like Swagit's.
  if (looksLikeVtt(raw)) return withOffsets('vtt', parseTimedBlocks(raw));
  if (
    normalize(raw)
      .split('\n')
      .some((l) => STAMP_LINE.test(l.trim()))
  ) {
    return withOffsets('stamped', parseStampedText(raw));
  }
  const text = normalize(raw)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return { format: 'text', cues: [], text, offsets: [] };
}

/**
 * A compact index from text position to time, small enough to keep in a record's `raw`:
 * `starts[i]` seconds begin at character `offsets[i]` of the cue text.
 */
export type CueIndex = { starts: number[]; offsets: number[] };

export function cueIndex(parsed: Pick<ParsedCaptions, 'cues' | 'offsets'>): CueIndex {
  return { starts: parsed.cues.map((c) => c.start), offsets: [...parsed.offsets] };
}

/**
 * The second a character of the cue text was said: the start of the cue that holds it. Null
 * with no cues. `base` is where the cue text begins inside a longer stored text (after a header).
 */
export function secondsAt(index: CueIndex, offset: number, base = 0): number | null {
  const at = offset - base;
  if (!index.starts.length) return null;
  if (at < 0) return index.starts[0]!;
  let lo = 0;
  let hi = index.offsets.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (index.offsets[mid]! <= at) lo = mid;
    else hi = mid - 1;
  }
  return index.starts[lo]!;
}
