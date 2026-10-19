import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  clock,
  cueIndex,
  looksLikeSrt,
  looksLikeVtt,
  parseCaptions,
  secondsAt,
  timestampToSeconds,
} from '../src/lib/captions';

// Caption files for staff uploads and transcript timestamps. The first group is ported from
// Kyle's TownCore (lib/meetings/vtt.test.mts); the rest cover SRT, stamped text, roll-up
// captions and Swagit's real layout.

const cues = (raw: string, name?: string) => parseCaptions(raw, name).cues;

describe('WebVTT (ported)', () => {
  it('parses a standard Zoom VTT with header and numeric cue ids', () => {
    const vtt = `WEBVTT

1
00:00:05.000 --> 00:00:09.500
John Smith: Good evening, everyone.

2
00:00:10.000 --> 00:00:14.000
Let's call this meeting to order.`;
    const parsed = parseCaptions(vtt);
    expect(parsed.format).toBe('vtt');
    expect(parsed.cues).toEqual([
      { start: 5, end: 9, text: 'John Smith: Good evening, everyone.' },
      { start: 10, end: 14, text: "Let's call this meeting to order." },
    ]);
    expect(parsed.text).toBe(
      "John Smith: Good evening, everyone.\nLet's call this meeting to order.",
    );
    expect(parsed.offsets).toEqual([0, 36]);
  });

  it('rolls hours into seconds and accepts mm:ss timing', () => {
    expect(cues('WEBVTT\n\n01:02:03.000 --> 01:02:05.000\nThree hours in.')[0]!.start).toBe(3723);
    expect(cues('WEBVTT\n\n02:30.000 --> 02:35.000\nHalfway.')[0]!.start).toBe(150);
  });

  it('accepts comma decimal separators', () => {
    expect(cues('WEBVTT\n\n00:00:07,250 --> 00:00:09,000\nComma seconds.')[0]!.start).toBe(7);
  });

  it('strips voice tags and other markup', () => {
    expect(
      cues('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Jane Doe>The motion <i>passes</i>.</v>')[0]!
        .text,
    ).toBe('The motion passes.');
  });

  it("collapses a cue's lines into one", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:06.000
The budget for fiscal year
2026 was approved unanimously.`;
    expect(cues(vtt)[0]!.text).toBe('The budget for fiscal year 2026 was approved unanimously.');
  });

  it('drops consecutive duplicate cues', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.000
Roll call.

00:00:03.000 --> 00:00:05.000
Roll call.

00:00:05.000 --> 00:00:07.000
All present.`;
    expect(cues(vtt).map((c) => c.text)).toEqual(['Roll call.', 'All present.']);
  });

  it('skips NOTE and STYLE blocks and malformed cues without throwing', () => {
    const vtt = `WEBVTT

NOTE This is a comment block.

STYLE
::cue { color: white }

garbage line with no timing

00:00:xx.000 --> 00:00:03.000
Bad timing.

00:00:02.000 --> 00:00:04.000 align:start position:10%
Only real cue.`;
    expect(cues(vtt)).toEqual([{ start: 2, end: 4, text: 'Only real cue.' }]);
  });

  it('parses a headerless body, and junk gives an empty transcript', () => {
    expect(cues('00:00:01.000 --> 00:00:02.000\nNo header here.')).toHaveLength(1);
    expect(parseCaptions('')).toEqual({ format: 'text', cues: [], text: '', offsets: [] });
    expect(parseCaptions('just some pasted prose with no timings').cues).toEqual([]);
  });

  it('detects VTT, and rejects prose', () => {
    expect(looksLikeVtt('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi.')).toBe(true);
    expect(looksLikeVtt('\uFEFFWEBVTT\n')).toBe(true);
    expect(looksLikeVtt('00:01:02.000 --> 00:01:03.000\nNo header.')).toBe(true);
    expect(looksLikeVtt('The council met on Tuesday and voted 5-2.')).toBe(false);
  });
});

describe('SRT, stamped text and roll-up captions', () => {
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:04,000',
    '<font color="#fff">Call to order.</font>',
    '',
    '2',
    '00:01:10,500 --> 00:01:14,000',
    '{\\an8}Motion to approve',
    'Resolution 72-26.',
    '',
  ].join('\r\n');

  it('reads SRT by its extension or its shape', () => {
    expect(looksLikeSrt(srt)).toBe(true);
    for (const name of ['council.srt', undefined]) {
      const parsed = parseCaptions(srt, name);
      expect(parsed.format).toBe('srt');
      expect(parsed.cues).toEqual([
        { start: 1, end: 4, text: 'Call to order.' },
        { start: 70, end: 74, text: 'Motion to approve Resolution 72-26.' },
      ]);
    }
  });

  it('keeps only the new words of roll-up captions', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.000
the motion

00:00:02.000 --> 00:00:03.000
the motion carries five to nothing`;
    expect(cues(vtt).map((c) => c.text)).toEqual(['the motion', 'carries five to nothing']);
  });

  it('reads text with [hh:mm:ss] lines as cues, and plain text as lines without cues', () => {
    const stamped =
      '  [00:00:01]\n  CALL TO ORDER.\n  [00:05:48]\n  [9. Resolution 72-26 ]\nMOTION.';
    const parsed = parseCaptions(stamped, 'meeting.txt');
    expect(parsed.format).toBe('stamped');
    expect(parsed.cues).toEqual([
      { start: 1, end: null, text: 'CALL TO ORDER.' },
      { start: 348, end: null, text: '[9. Resolution 72-26 ]\nMOTION.' },
    ]);
    const plain = parseCaptions('  Call to order.\n\n\nMotion   carried. ', 'notes.txt');
    expect(plain).toEqual({
      format: 'text',
      cues: [],
      text: 'Call to order.\nMotion carried.',
      offsets: [],
    });
  });

  it('a .txt that is really VTT is read as VTT', () => {
    expect(parseCaptions('WEBVTT\n\n00:00:03.000 --> 00:00:04.000\nHi.', 'x.txt').format).toBe(
      'vtt',
    );
  });

  it("reads Swagit's real transcript layout: a stamp every five minutes", () => {
    // Recorded live from jupiterfl.new.swagit.com (Town of Jupiter, FL) on 2026-10-16.
    const fixture = fileURLToPath(
      new URL('../fixtures/civicclerk/jupiter-events.json', import.meta.url),
    );
    const { exchanges } = JSON.parse(readFileSync(fixture, 'utf8')) as {
      exchanges: { url: string; body: string }[];
    };
    const raw = exchanges.find((e) => e.url.endsWith('/videos/403164/transcript'))!.body;
    const parsed = parseCaptions(raw, 'transcript.txt');
    expect(parsed.format).toBe('stamped');
    expect(parsed.cues).toHaveLength(21);
    expect(parsed.cues[0]!.start).toBe(1);
    expect(parsed.cues.at(-1)!.start).toBe(6006); // [01:40:06]
    // Every character maps back to the stamp before it.
    const index = cueIndex(parsed);
    const hearing = parsed.text.indexOf('[9. Resolution 72-26');
    expect(hearing).toBeGreaterThan(0);
    const at = secondsAt(index, hearing)!;
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(6006);
    expect(secondsAt(index, 0)).toBe(1);
  });
});

describe('time helpers', () => {
  it('converts between timestamps, seconds and clocks', () => {
    expect(timestampToSeconds('1:02:03')).toBe(3723);
    expect(timestampToSeconds('nope')).toBeNull();
    expect(clock(75)).toBe('1:15');
    expect(clock(3723)).toBe('1:02:03');
  });

  it('maps a text position to the cue that holds it, after any header', () => {
    const index = { starts: [5, 10, 70], offsets: [0, 20, 40] };
    expect(secondsAt(index, 0)).toBe(5);
    expect(secondsAt(index, 19)).toBe(5);
    expect(secondsAt(index, 20)).toBe(10);
    expect(secondsAt(index, 500)).toBe(70);
    expect(secondsAt(index, 130, 100)).toBe(10);
    expect(secondsAt(index, 50, 100)).toBe(5);
    expect(secondsAt({ starts: [], offsets: [] }, 3)).toBeNull();
  });
});
