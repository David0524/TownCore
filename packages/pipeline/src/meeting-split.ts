import { clock, secondsAt, type CueIndex } from '@towncore/adapters';
import type { records } from '@towncore/db';
import { meetingSplitV1, type MeetingSplitItem } from '@towncore/prompts';
import { callModel, routeFor, type Llm, type LlmTown } from './llm';

// Meeting splitter: one meeting, several stories. A meeting's minutes or recorded actions are
// read one chunk at a time by the `meeting-split` prompt, which lists each decision with a
// verbatim excerpt, any stated tally and where the transcript discusses it. Code then checks
// every excerpt and tally against the records, character for character apart from spacing and
// typographic quotes and dashes, and drops what fails; finds or checks the transcript window;
// and decides whether to split at all (two or more newsworthy decisions, otherwise the meeting
// stays one recap). Each decision becomes its own story candidate, written and fact-checked from
// the minutes around it and only its stretch of transcript, never the whole thing.
//
// Rules kept (D-M2-4 as amended 2026-10-16): the minutes are the source; a transcript only
// locates and adds detail, is never a story's only source, and any story citing one goes to
// review (write.ts). No caption scraping: transcripts are the companion records adapters already
// fetch where robots.txt allows (Swagit) or files staff upload (captions.ts).
//
// Off by default: the `meeting-split` route is disabled until its prompt is recorded with
// `pnpm evals --live`.

/** Record types a meeting's decisions are read from. */
export const MEETING_RESULT_TYPES = ['minutes', 'meeting-actions'];
/** Split only when at least this many newsworthy decisions pass the checks. */
export const SPLIT_MIN_ITEMS = 2;
/** At most this many stories from one meeting (the daily budget still decides what's written). */
export const SPLIT_MAX_ITEMS = 4;
/** Minutes are sent to the splitter in parts of about this many characters… */
export const MINUTES_CHUNK_CHARS = 12_000;
/** …overlapping by this much, so an item on a boundary is seen whole in one part. */
export const MINUTES_CHUNK_OVERLAP = 1_500;
/** The writer gets whole minutes up to this size; longer ones, the item with a margin. */
export const MINUTES_FULL_CHARS = 12_000;
export const MINUTES_MARGIN = 3_000;
/** Transcript text added on each side of an item's window. */
export const TRANSCRIPT_MARGIN = 1_500;
/** The longest transcript window kept for one item (its best-matching stretch, if longer). */
export const TRANSCRIPT_WINDOW_MAX = 20_000;
/** Outline lines: a time every this many seconds (timed captions)… */
const OUTLINE_STEP_SECONDS = 60;
/** …or every this many characters (untimed text without agenda markers). */
const OUTLINE_STEP_CHARS = 4_000;
const OUTLINE_SNIPPET = 60;
/** Lexical search for an item's discussion: window size, step and the score it must reach. */
const SEARCH_WINDOW = 4_000;
const SEARCH_STEP = 1_000;
const SEARCH_MIN_SCORE = 4;
/** A word said more often than this in the whole transcript doesn't place an item. */
const SEARCH_RARE_MAX = 6;
/** A window the model gives must share at least this much with the item (a number, or 3 words). */
const MODEL_WINDOW_MIN_SCORE = 3;
/** How far after the excerpt a tally may sit (Jupiter's vote rows follow the motion). */
const TALLY_REACH = 600;

export const MEETING_SPLIT_VERSION = `${meetingSplitV1.id}@${meetingSplitV1.version}`;

type Rec = Pick<typeof records.$inferSelect, 'id' | 'type' | 'title' | 'text' | 'raw'>;

/** One checked decision, kept on its story candidate (`classification.meeting_item`). */
export type MeetingItem = {
  version: string;
  /** Order in the meeting, from 0. */
  index: number;
  topic: string;
  agendaNumber: string | null;
  outcome: string;
  /** As the record writes it, or null. */
  voteTally: string | null;
  /** The minutes or actions record the excerpt is in, and where. */
  recordId: string;
  excerpt: string;
  excerptStart: number;
  excerptEnd: number;
  transcript: {
    recordId: string;
    start: number;
    end: number;
    startSeconds: number | null;
    endSeconds: number | null;
    /** The model's window, checked; or found by code from the agenda marker or the words. */
    located: 'model' | 'marker' | 'search';
  } | null;
  newsworthy: boolean;
  impact: number;
  novelty: number;
  proximity: number;
  reason: string;
};

export type SplitResult = {
  /** Every decision that passed the checks, in meeting order. */
  items: MeetingItem[];
  /** What the checks dropped, and why. */
  dropped: Array<{ topic: string; reason: string }>;
  calls: number;
};

/** True when the splitter's route is switched on (it ships off). */
export function meetingSplitEnabled(llm: Llm | undefined): llm is Llm {
  return Boolean(llm) && !routeFor(llm!, 'meeting-split').disabled;
}

/** The checked decision a story candidate was split from, if any. */
export function meetingItemOf(classification: unknown): MeetingItem | null {
  const item = (classification as { meeting_item?: MeetingItem } | null)?.meeting_item;
  return item && typeof item.recordId === 'string' ? item : null;
}

// ---------------------------------------------------------------------------------------------
// Text helpers

/**
 * Splits text into parts of about `size` characters at line breaks (a blank line if one is in
 * the back half), each overlapping the last by about `overlap`. Never drops text.
 */
export function chunkText(
  text: string,
  size = MINUTES_CHUNK_CHARS,
  overlap = MINUTES_CHUNK_OVERLAP,
): Array<{ start: number; text: string }> {
  if (text.length <= size) return [{ start: 0, text }];
  const chunks: Array<{ start: number; text: string }> = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const half = start + Math.floor(size / 2);
      const para = text.lastIndexOf('\n\n', end);
      const line = text.lastIndexOf('\n', end);
      end = para > half ? para + 2 : line > half ? line + 1 : end;
    }
    chunks.push({ start, text: text.slice(start, end) });
    if (end >= text.length) break;
    let next = Math.max(start + 1, end - overlap);
    const lineStart = text.lastIndexOf('\n', next);
    if (lineStart > start) next = lineStart + 1;
    start = next;
  }
  return chunks;
}

const TYPOGRAPHIC: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  ' ': ' ',
};

/** Spacing collapsed and curly quotes and dashes made plain, with a map back to the original. */
function squeeze(text: string): { out: string; map: number[] } {
  let out = '';
  const map: number[] = [];
  let space = true;
  for (let i = 0; i < text.length; i++) {
    const ch = TYPOGRAPHIC[text[i]!] ?? text[i]!;
    if (/\s/.test(ch)) {
      if (!space) {
        out += ' ';
        map.push(i);
        space = true;
      }
    } else {
      out += ch;
      map.push(i);
      space = false;
    }
  }
  return { out, map };
}

/**
 * Where `needle` is in `haystack`, word for word: spacing and line breaks, and curly quotes or
 * dashes against plain ones, are the only differences allowed (and letter case with
 * `ignoreCase`). Positions are the haystack's own, so the record's exact text can be cut out.
 */
export function findVerbatim(
  haystack: string,
  needle: string,
  opts: { ignoreCase?: boolean; from?: number; to?: number } = {},
): { start: number; end: number } | null {
  const from = opts.from ?? 0;
  const to = opts.to ?? haystack.length;
  const h = squeeze(haystack.slice(from, to));
  const n = squeeze(needle).out.trim();
  if (!n) return null;
  const H = opts.ignoreCase ? h.out.toLowerCase() : h.out;
  const N = opts.ignoreCase ? n.toLowerCase() : n;
  const at = H.indexOf(N);
  if (at < 0) return null;
  return { start: from + h.map[at]!, end: from + h.map[at + N.length - 1]! + 1 };
}

const STOP = new Set(
  (
    'about above after again against agenda also approve approved approving amended amendment ' +
    'been board called carried city clerk commission commissioner council councilor consent ' +
    'denied discussion during each favor file following from have item items mayor meeting ' +
    'minutes more motion moved only other over passed please public received regular request ' +
    'resolution said second seconded such than that their them then there these they this ' +
    'those through town under until upon very vice were what when where which while will ' +
    'with would yes your'
  ).split(' '),
);

/** Lowercase words of four letters or more. */
const wordsOf = (text: string) => text.toLowerCase().match(/[a-z]{4,}/g) ?? [];

/** The words and numbers an item can be found by in a transcript. */
export function itemKeys(text: string): { ids: string[]; words: string[] } {
  const lower = text.toLowerCase();
  const ids = [
    ...new Set((lower.match(/\d[\d,./-]*\d/g) ?? []).filter((n) => !/^(19|20)\d\d$/.test(n))),
  ];
  const words = [...new Set(wordsOf(text).filter((w) => !STOP.has(w)))];
  return { ids, words };
}

/** Numbers count three, whole words one each. */
function keyScore(text: string, keys: { ids: string[]; words: string[] }): number {
  const lower = text.toLowerCase();
  const present = new Set(wordsOf(text));
  let score = 0;
  for (const id of keys.ids) if (lower.includes(id)) score += 3;
  for (const w of keys.words) if (present.has(w)) score += 1;
  return score;
}

/**
 * Keys rare in this transcript: "contract" is said all evening, a company's name isn't, so a
 * common word never places an item in someone else's discussion.
 */
function rareKeys(text: string, keys: { ids: string[]; words: string[] }) {
  const counts = new Map<string, number>();
  for (const w of wordsOf(text)) counts.set(w, (counts.get(w) ?? 0) + 1);
  const lower = text.toLowerCase();
  return {
    ids: keys.ids.filter((id) => lower.split(id).length - 1 <= SEARCH_RARE_MAX),
    words: keys.words.filter((w) => (counts.get(w) ?? 0) <= SEARCH_RARE_MAX),
  };
}

/** The best-matching stretch of `size` characters in [from, to), by the item's words. */
function bestStretch(
  text: string,
  keys: { ids: string[]; words: string[] },
  from: number,
  to: number,
  size: number,
): { start: number; end: number; score: number } {
  let best = { start: from, end: Math.min(to, from + size), score: -1 };
  for (let at = from; at < to; at += SEARCH_STEP) {
    const end = Math.min(to, at + size);
    const score = keyScore(text.slice(at, end), keys);
    if (score > best.score) best = { start: at, end, score };
    if (end >= to) break;
  }
  return best;
}

/** Agenda marker lines in a transcript ("[9. Resolution 72-26, …]"), with their positions. */
export function agendaMarkers(text: string): Array<{ offset: number; label: string }> {
  const out: Array<{ offset: number; label: string }> = [];
  const re = /^\[(\d+(?:\.[A-Z0-9]+)*\.?)\s[^\]\n]*\]?/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ offset: m.index, label: m[0] });
  return out;
}

/** Timing kept on an uploaded transcript record (captions.ts). */
function cueIndexOf(record: Rec): (CueIndex & { base: number }) | null {
  const raw = (record.raw ?? {}) as { cues?: CueIndex; cueBase?: number };
  if (!raw.cues?.starts?.length) return null;
  return { ...raw.cues, base: raw.cueBase ?? 0 };
}

/**
 * The transcript as the splitter sees it: never its text, only positions to point at. Agenda
 * markers, a time every minute when the captions are timed, and the first words every few
 * thousand characters when there's nothing else.
 */
export function transcriptOutline(record: Rec): string {
  const text = record.text ?? '';
  const lines: Array<{ offset: number; line: string }> = agendaMarkers(text).map((m) => ({
    offset: m.offset,
    line: m.label.slice(0, 160),
  }));
  const snippet = (at: number) => text.slice(at, at + OUTLINE_SNIPPET).replace(/\s+/g, ' ');
  const index = cueIndexOf(record);
  if (index) {
    let next = 0;
    index.starts.forEach((start, i) => {
      if (start < next) return;
      const at = index.base + index.offsets[i]!;
      lines.push({ offset: at, line: `[${clock(start)}] ${snippet(at)}` });
      next = start + OUTLINE_STEP_SECONDS;
    });
  } else if (!lines.length) {
    for (let at = 0; at < text.length; at += OUTLINE_STEP_CHARS) {
      const lineStart = at === 0 ? 0 : text.indexOf('\n', at) + 1;
      if (lineStart <= 0 || lineStart >= text.length) continue;
      lines.push({ offset: lineStart, line: snippet(lineStart) });
    }
  }
  lines.sort((a, b) => a.offset - b.offset);
  return [
    `Transcript ${record.id}: ${text.length} characters.`,
    ...lines.map((l) => `@${l.offset} ${l.line}`),
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Checks

type Window = NonNullable<MeetingItem['transcript']>;

/** Where the transcript discusses an item: the model's window if it holds up, else code's. */
export function locateWindow(
  transcript: Rec,
  item: Pick<MeetingSplitItem, 'agenda_number' | 'topic' | 'minutes_excerpt'> & {
    transcript_window: MeetingSplitItem['transcript_window'];
  },
): Window | null {
  const text = transcript.text ?? '';
  if (!text) return null;
  const keys = rareKeys(text, itemKeys(`${item.topic}\n${item.minutes_excerpt}`));
  const markers = agendaMarkers(text);
  const make = (start: number, end: number, located: Window['located']): Window => {
    if (end - start > TRANSCRIPT_WINDOW_MAX) {
      ({ start, end } = bestStretch(text, keys, start, end, TRANSCRIPT_WINDOW_MAX));
    }
    const index = cueIndexOf(transcript);
    return {
      recordId: transcript.id,
      start,
      end,
      startSeconds: index ? secondsAt(index, start, index.base) : null,
      endSeconds: index ? secondsAt(index, end, index.base) : null,
      located,
    };
  };

  // 1. The model's window, when it's inside the text and talks about the item.
  const w = item.transcript_window;
  if (w && w.start >= 0 && w.end > w.start && w.start < text.length) {
    const end = Math.min(w.end, text.length);
    if (keyScore(text.slice(w.start, end), keys) >= MODEL_WINDOW_MIN_SCORE) {
      return make(w.start, end, 'model');
    }
  }
  // 2. The clerk's agenda marker for the item's number, up to the next marker.
  const num = item.agenda_number?.trim().replace(/\.$/, '');
  if (num) {
    const i = markers.findIndex(
      (m) => m.label.startsWith(`[${num}.`) || m.label.startsWith(`[${num} `),
    );
    if (i >= 0) {
      const end =
        markers[i + 1]?.offset ?? Math.min(text.length, markers[i]!.offset + TRANSCRIPT_WINDOW_MAX);
      return make(markers[i]!.offset, end, 'marker');
    }
  }
  // 3. The stretch that shares the most of the item's numbers and words, scanning all of it.
  const best = bestStretch(text, keys, 0, text.length, SEARCH_WINDOW);
  return best.score >= SEARCH_MIN_SCORE ? make(best.start, best.end, 'search') : null;
}

/**
 * Checks one answer item against the records: the excerpt word for word in a record it cites,
 * the tally word for word at or just after the excerpt, and the transcript window found or
 * confirmed. Returns the reason when it fails.
 */
export function verifyItem(
  raw: MeetingSplitItem,
  minutes: Rec[],
  transcript: Rec | null,
): Omit<MeetingItem, 'index' | 'version'> | { failed: string } {
  const cited = minutes.filter((m) => raw.record_ids.includes(m.id));
  if (!cited.length) return { failed: 'cites no minutes or actions record it was given' };
  let found: { record: Rec; start: number; end: number } | null = null;
  for (const record of cited) {
    const at = findVerbatim(record.text ?? '', raw.minutes_excerpt);
    if (at) {
      found = { record, ...at };
      break;
    }
  }
  if (!found) return { failed: 'excerpt is not word for word in the cited record' };
  const text = found.record.text ?? '';
  let voteTally: string | null = null;
  if (raw.vote_tally?.trim()) {
    const at = findVerbatim(text, raw.vote_tally, {
      ignoreCase: true,
      from: found.start,
      to: Math.min(text.length, found.end + TALLY_REACH),
    });
    if (!at) return { failed: `vote tally "${raw.vote_tally}" is not in the record at this item` };
    voteTally = text.slice(at.start, at.end);
  }
  return {
    topic: raw.topic.trim(),
    agendaNumber: raw.agenda_number?.trim() || null,
    outcome: raw.outcome.trim(),
    voteTally,
    recordId: found.record.id,
    excerpt: text.slice(found.start, found.end),
    excerptStart: found.start,
    excerptEnd: found.end,
    transcript: transcript ? locateWindow(transcript, raw) : null,
    newsworthy: raw.newsworthy,
    impact: raw.impact,
    novelty: raw.novelty,
    proximity: raw.proximity,
    reason: raw.reason,
  };
}

/** Items from overlapping parts that are the same decision: the same excerpt, or one inside another. */
function sameDecision(a: MeetingItem, b: MeetingItem): boolean {
  return (
    a.recordId === b.recordId && a.excerptStart < b.excerptEnd && b.excerptStart < a.excerptEnd
  );
}

// ---------------------------------------------------------------------------------------------
// The split

/**
 * Asks the splitter about each part of each minutes record, then checks every answer. Throws
 * what callModel throws (a spend cap, or output that fails its schema after escalation).
 */
export async function splitMeeting(
  llm: Llm,
  args: {
    town: LlmTown;
    townLines: string;
    minutes: Rec[];
    transcript: Rec | null;
    job?: string;
  },
): Promise<SplitResult> {
  const outline = args.transcript?.text ? transcriptOutline(args.transcript) : null;
  const answers: MeetingSplitItem[] = [];
  let calls = 0;
  for (const record of args.minutes) {
    const parts = chunkText(record.text ?? '');
    for (const [i, part] of parts.entries()) {
      const { value } = await callModel(llm, {
        job: args.job ?? 'story-finder.meeting-split',
        town: args.town,
        prompt: meetingSplitV1,
        inputPrefix: args.townLines,
        input: [
          '',
          `--- Record ${record.id} (${record.type})${parts.length > 1 ? `, part ${i + 1} of ${parts.length}` : ''}`,
          `Title: ${record.title ?? ''}`,
          part.text,
          '',
          outline ? `=== Transcript outline\n${outline}` : '=== No transcript for this meeting.',
        ].join('\n'),
      });
      calls++;
      answers.push(...value.items);
    }
  }

  const dropped: SplitResult['dropped'] = [];
  const items: MeetingItem[] = [];
  for (const raw of answers) {
    const checked = verifyItem(raw, args.minutes, args.transcript);
    if ('failed' in checked) {
      dropped.push({ topic: raw.topic, reason: checked.failed });
      continue;
    }
    const item: MeetingItem = { ...checked, index: 0, version: MEETING_SPLIT_VERSION };
    const twin = items.findIndex((other) => sameDecision(other, item));
    if (twin < 0) items.push(item);
    // Seen in two overlapping parts: keep the fuller reading.
    else if (item.excerpt.length > items[twin]!.excerpt.length) items[twin] = item;
  }
  const order = args.minutes.map((m) => m.id);
  items.sort(
    (a, b) =>
      order.indexOf(a.recordId) - order.indexOf(b.recordId) || a.excerptStart - b.excerptStart,
  );
  items.forEach((item, i) => (item.index = i));
  return { items, dropped, calls };
}

const weight = (i: MeetingItem) => i.impact + i.novelty + i.proximity;

/**
 * Which decisions become their own stories: the newsworthy ones, the strongest
 * `SPLIT_MAX_ITEMS`, in meeting order. Null keeps the meeting as one recap (fewer than
 * `SPLIT_MIN_ITEMS` newsworthy decisions), so a meeting is never covered both ways.
 */
export function chooseSplit(
  items: MeetingItem[],
): { split: MeetingItem[]; left: MeetingItem[] } | null {
  const news = items.filter((i) => i.newsworthy);
  if (news.length < SPLIT_MIN_ITEMS) return null;
  const strongest = [...news].sort((a, b) => weight(b) - weight(a) || a.index - b.index);
  const split = strongest.slice(0, SPLIT_MAX_ITEMS).sort((a, b) => a.index - b.index);
  return { split, left: strongest.slice(SPLIT_MAX_ITEMS).sort((a, b) => a.index - b.index) };
}

// ---------------------------------------------------------------------------------------------
// What the writer and fact-check see for one decision

/** The record text up to its first blank line (when, where, body, video): context for any cut. */
function header(text: string, max: number): string {
  const blank = text.indexOf('\n\n');
  return blank > 0 && blank <= max ? text.slice(0, blank) : '';
}

function lineStart(text: string, at: number): number {
  return at <= 0 ? 0 : text.lastIndexOf('\n', at - 1) + 1;
}
function lineEnd(text: string, at: number): number {
  if (at >= text.length) return text.length;
  const nl = text.indexOf('\n', at);
  return nl < 0 ? text.length : nl;
}

/**
 * A record's text as the writer and fact-check get it for one decision: whole minutes when
 * short, else the item with a margin; for the transcript, only the item's window with a margin.
 * Other records are unchanged. Fact-check checks against exactly this text.
 */
export function itemSourceText(record: Rec, item: MeetingItem): string {
  const text = record.text ?? '';
  if (record.id === item.recordId) {
    if (text.length <= MINUTES_FULL_CHARS) return text;
    const head = header(text, 800);
    const from = Math.max(head.length, lineStart(text, item.excerptStart - MINUTES_MARGIN));
    const to = lineEnd(text, item.excerptEnd + MINUTES_MARGIN);
    return [head, '[…]', text.slice(from, to).trim(), to < text.length ? '[…]' : '']
      .filter(Boolean)
      .join('\n');
  }
  const w = item.transcript;
  if (w && record.id === w.recordId) {
    const head = header(text, 800);
    const from = Math.max(head.length, lineStart(text, w.start - TRANSCRIPT_MARGIN));
    const to = lineEnd(text, w.end + TRANSCRIPT_MARGIN);
    const when =
      w.startSeconds !== null && w.endSeconds !== null
        ? ` from ${clock(w.startSeconds)} to ${clock(w.endSeconds)}`
        : '';
    return [
      head,
      `[Transcript excerpt${when}: characters ${from}–${to} of ${text.length}; the rest of the meeting is left out.]`,
      text.slice(from, to).trim(),
    ]
      .filter(Boolean)
      .join('\n');
  }
  return text;
}

/** The note the writer gets with a decision's records: what this story covers. */
export function itemFocus(item: MeetingItem): string {
  return [
    `This story covers one decision from the meeting: ${item.topic} (${item.outcome}).`,
    'Other decisions from the meeting are separate stories: mention them only if this one depends on them.',
  ].join(' ');
}
