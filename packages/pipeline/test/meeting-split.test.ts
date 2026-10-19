import { fileURLToPath } from 'node:url';
import {
  civicclerkAdapter,
  Fetcher,
  legistarAdapter,
  replayFetch,
  type RawRecord,
} from '@towncore/adapters';
import { loadTowns, taskRoutes, type TownConfig } from '@towncore/config';
import {
  aiRequests,
  aiUsage,
  articleScores,
  articles,
  eq,
  getTownBySlug,
  records,
  skippedCandidates,
  sources,
  storyCandidates,
  syncTowns,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import {
  classifyV1,
  factcheckV1,
  meetingSplitV1,
  writerV1,
  type Classification,
  type FactcheckResult,
  type MeetingSplitItem,
  type WriterDraft,
} from '@towncore/prompts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runStoryFinder } from '../src/finder';
import type { Llm, LlmProvider, LlmResponse } from '../src/llm';
import {
  chooseSplit,
  chunkText,
  findVerbatim,
  itemSourceText,
  locateWindow,
  meetingItemOf,
  meetingSplitEnabled,
  transcriptOutline,
  verifyItem,
  type MeetingItem,
} from '../src/meeting-split';
import { writeCandidate } from '../src/write';
import { classification } from './helpers';

// The meeting splitter, against real minutes and actions recorded from Jupiter's CivicClerk
// (with its Swagit transcript) and Delray Beach's Legistar, and a stub model. The model's
// answers are scripted; everything the code decides (verbatim checks, transcript windows, the
// split-or-not rule, candidates, budget and the writer's inputs) is real.

const fixture = (f: string) =>
  fileURLToPath(new URL(`../../adapters/fixtures/${f}`, import.meta.url));
const replayCtx = (f: string) => ({
  fetcher: new Fetcher({
    fetchImpl: replayFetch(fixture(f)),
    sleep: async () => {},
    now: () => 0,
    minIntervalMs: 0,
  }),
  now: new Date('2026-10-16T12:00:00Z'),
});

let jupiter: RawRecord[] = [];
let delray: RawRecord[] = [];
const raw = (list: RawRecord[], id: string) => list.find((r) => r.externalId === id)!;

/** Text in a record from `from` to the first `to` after it, inclusive: a model's verbatim copy. */
function between(text: string, from: string, to: string): string {
  const a = text.indexOf(from);
  const b = text.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`not in record: ${from} … ${to}`);
  return text.slice(a, b + to.length);
}

const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));
// The day after Delray's Oct. 13 commission meeting.
const NOW = new Date('2026-10-14T15:00:00Z');
const ON = { 'meeting-split': { disabled: false } } as const;

let db: Db;
let drop: () => Promise<void>;
let townId: string;
let sourceId: string;

type Answers = {
  /** The splitter's answer for an input, or 'invalid' for output that fails its schema. */
  split?: (input: string) => { items: MeetingSplitItem[] } | 'invalid';
  classify?: Partial<Classification>;
  writer?: WriterDraft;
  factcheck?: FactcheckResult;
};

/** A stub provider that answers each prompt from a script and records every request. */
function stub(answers: Answers, opts: { on?: boolean } = {}) {
  const seen: { prompt: string; input: string }[] = [];
  const provider: LlmProvider = {
    name: 'replay',
    async generate(request): Promise<LlmResponse> {
      const prompt =
        request.system === meetingSplitV1.system
          ? 'split'
          : request.system === classifyV1.system
            ? 'classify'
            : request.system === writerV1.system
              ? 'writer'
              : request.system === factcheckV1.system
                ? 'factcheck'
                : 'other';
      seen.push({ prompt, input: request.input });
      const usage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0 };
      const answer =
        prompt === 'split'
          ? (answers.split?.(request.input) ?? { items: [] })
          : prompt === 'classify'
            ? classification({ impact: 0.9, novelty: 0.8, proximity: 0.8, ...answers.classify })
            : prompt === 'writer'
              ? answers.writer
              : answers.factcheck;
      return {
        text: answer === 'invalid' ? '{"items": "nope"}' : JSON.stringify(answer),
        stop: 'end',
        model: 'gemini-flash-lite-latest',
        usage,
      };
    },
  };
  const llm: Llm = {
    db,
    provider,
    providerName: 'gemini',
    now: () => NOW,
    ...(opts.on === false ? {} : { routeOverrides: ON }),
  };
  return { llm, seen };
}

/** The record a splitter request is about. */
const recordIdIn = (input: string) => input.match(/^--- Record (\S+)/m)![1]!;

/** One answer item with neutral defaults. */
function item(over: Partial<MeetingSplitItem> & Pick<MeetingSplitItem, 'minutes_excerpt'>) {
  return {
    topic: 'An item',
    agenda_number: null,
    outcome: 'approved',
    vote_tally: null,
    record_ids: [],
    transcript_window: null,
    newsworthy: true,
    impact: 0.6,
    novelty: 0.5,
    proximity: 0.5,
    reason: 'test',
    ...over,
  } satisfies MeetingSplitItem;
}

async function insert(r: RawRecord) {
  const [row] = await db
    .insert(records)
    .values({
      sourceId,
      townId,
      externalId: r.externalId,
      type: r.type,
      title: r.title,
      text: r.text,
      url: r.url,
      occurredAt: r.occurredAt,
      raw: r.raw,
      contentHash: r.externalId,
    })
    .returning();
  return row!;
}

async function setConfig(over: Partial<TownConfig>) {
  const [town] = await db.select().from(towns).where(eq(towns.id, townId));
  await db
    .update(towns)
    .set({ config: { ...(town!.config as TownConfig), ...over } })
    .where(eq(towns.id, townId));
}

async function all() {
  const rows = await db.select().from(storyCandidates).where(eq(storyCandidates.townId, townId));
  const skips = await db.select().from(skippedCandidates);
  const by = new Map(skips.map((s) => [s.candidateId, s]));
  return rows.map((c) => ({ ...c, skip: by.get(c.id) ?? null }));
}

beforeAll(async () => {
  jupiter = await civicclerkAdapter.fetch(
    {
      id: 'civicclerk',
      townId: 't',
      kind: 'agenda',
      platform: 'civicclerk',
      url: 'https://jupiterfl.portal.civicclerk.com/',
      config: { timezone: 'America/New_York', pastDays: 14, aheadDays: 21 },
    },
    null,
    replayCtx('civicclerk/jupiter-events.json'),
  );
  delray = await legistarAdapter.fetch(
    {
      id: 'legistar',
      townId: 't',
      kind: 'agenda',
      platform: 'legistar',
      url: 'https://delraybeach.legistar.com/',
      config: { timezone: 'America/New_York', pastDays: 14, aheadDays: 14 },
    },
    null,
    replayCtx('legistar/delray-events.json'),
  );
  ({ db, drop } = await createTestDb());
  const loaded = loadTowns(townsDir).filter((t) => t.config.slug === 'boca-raton');
  await syncTowns(
    db,
    loaded.map((t) => ({ ...t, config: { ...t.config, sources: [] } })),
  );
  townId = (await getTownBySlug(db, 'boca-raton'))!.id;
  const [s] = await db
    .insert(sources)
    .values({ townId, kind: 'agenda', platform: 'test', adapter: 'test', key: 'meetings' })
    .returning();
  sourceId = s!.id;
});
afterAll(async () => drop());
beforeEach(async () => {
  await db.delete(articles);
  await db.delete(skippedCandidates);
  await db.delete(articleScores);
  await db.delete(storyCandidates);
  await db.delete(records);
  await db.delete(aiUsage);
  await db.delete(aiRequests);
  await setConfig({ story_budget: 6, score_threshold: 40, ai_daily_call_cap: 400 });
});

// ---------------------------------------------------------------------------------------------

describe('text checks', () => {
  it('splits long text into overlapping parts at line breaks, never dropping any', () => {
    const lines = Array.from({ length: 400 }, (_, i) => `- ${i}. Item number ${i} was approved.`);
    const text = lines.join('\n');
    const parts = chunkText(text, 3000, 300);
    expect(parts.length).toBeGreaterThan(4);
    for (const [i, p] of parts.entries()) {
      expect(text.slice(p.start, p.start + p.text.length)).toBe(p.text);
      expect(p.text.length).toBeLessThanOrEqual(3000);
      if (i > 0) {
        expect(p.start).toBeLessThan(parts[i - 1]!.start + parts[i - 1]!.text.length);
        expect(text[p.start - 1]).toBe('\n'); // starts on a line
      }
    }
    expect(parts.at(-1)!.text.endsWith(lines.at(-1)!)).toBe(true);
    expect(chunkText('short', 3000, 300)).toEqual([{ start: 0, text: 'short' }]);
  });

  it('finds an excerpt word for word, allowing only spacing and typographic marks', () => {
    const text = 'Item 9. Shoppes at Jupiter – Site Plan,\n101 N. US Highway One. Motion passed.';
    expect(findVerbatim(text, 'Shoppes at Jupiter - Site Plan, 101 N. US Highway One.')).toEqual({
      start: 8,
      end: 62,
    });
    expect(findVerbatim(text, 'Shoppes at Jupiter - site plan')).toBeNull();
    expect(findVerbatim(text, 'MOTION PASSED', { ignoreCase: true })).toEqual({
      start: 63,
      end: 76,
    });
    expect(findVerbatim(text, 'Motion passed', { from: 0, to: 40 })).toBeNull();
    expect(findVerbatim(text, '   ')).toBeNull();
  });

  it('keeps the meeting as one recap unless two or more decisions are newsworthy', () => {
    const it = (index: number, newsworthy: boolean, impact = 0.5) =>
      ({ index, newsworthy, impact, novelty: 0, proximity: 0, topic: `t${index}` }) as MeetingItem;
    expect(chooseSplit([it(0, true), it(1, false), it(2, false)])).toBeNull();
    expect(chooseSplit([])).toBeNull();
    const five = chooseSplit([0, 1, 2, 3, 4, 5].map((i) => it(i, i !== 2, i === 0 ? 0.1 : 0.5)))!;
    // The four strongest, in meeting order; the weakest is left for the recap's skip note.
    expect(five.split.map((x) => x.index)).toEqual([1, 3, 4, 5]);
    expect(five.left.map((x) => x.index)).toEqual([0]);
  });

  it('is off unless its route is switched on', () => {
    expect(taskRoutes['meeting-split'].disabled).toBe(true);
    expect(meetingSplitEnabled(undefined)).toBe(false);
    expect(meetingSplitEnabled(stub({}, { on: false }).llm)).toBe(false);
    expect(meetingSplitEnabled(stub({}).llm)).toBe(true);
  });
});

describe('checks against the real Jupiter minutes and Swagit transcript', () => {
  const rec = (r: RawRecord, id: string) => ({
    id,
    type: r.type,
    title: r.title ?? null,
    text: r.text ?? null,
    raw: r.raw,
  });
  const minutes = () => rec(raw(jupiter, 'minutes:1491'), 'm');
  const transcript = () => rec(raw(jupiter, 'transcript:1491'), 't');
  // As a model copies it: one line, a plain dash.
  const hearing = () =>
    between(minutes().text!, '9. Resolution 72-26', 'motion passed.')
      .replace(/\s+/g, ' ')
      .replace('–', '-');

  it('outlines the transcript by its agenda markers, never its words', () => {
    const outline = transcriptOutline(transcript());
    expect(outline).toMatch(/^Transcript t: 87940 characters\./);
    expect(outline).toContain('@19789 [9. Resolution 72-26');
    expect(outline.split('\n')).toHaveLength(5);
    expect(outline).not.toContain('THE TIME IS NOW');
  });

  it('accepts a verbatim excerpt and a tally just after it, and finds the hearing by its marker', () => {
    const checked = verifyItem(
      item({
        topic: 'Shoppes at Jupiter site plan amendment',
        agenda_number: '9.',
        vote_tally: 'Yes Yes Yes Yes Yes',
        record_ids: ['m'],
        minutes_excerpt: hearing(),
      }),
      [minutes()],
      transcript(),
    );
    if ('failed' in checked) throw new Error(checked.failed);
    expect(checked.excerpt).toContain('Shoppes at Jupiter – Site Plan Amendment, 101 N.\nUS');
    expect(checked.voteTally).toBe('Yes Yes Yes Yes Yes');
    expect(checked.transcript).toMatchObject({ recordId: 't', start: 19789, located: 'marker' });
    // The hearing runs to the end of the meeting (no later marker), capped at its best stretch.
    expect(checked.transcript!.end - checked.transcript!.start).toBeLessThanOrEqual(20_000);
  });

  it("drops what isn't in the record: a paraphrase, a made-up tally, an uncited record", () => {
    const check = (over: Partial<MeetingSplitItem>) =>
      verifyItem(
        item({ record_ids: ['m'], minutes_excerpt: hearing(), ...over }),
        [minutes()],
        transcript(),
      );
    expect(
      check({ minutes_excerpt: 'The council approved the Shoppes at Jupiter site plan.' }),
    ).toEqual({ failed: 'excerpt is not word for word in the cited record' });
    expect(check({ vote_tally: '5-0' })).toEqual({
      failed: 'vote tally "5-0" is not in the record at this item',
    });
    // A tally from another item, far from this one, doesn't count.
    expect(
      check({
        minutes_excerpt: between(minutes().text!, '6. Resolution 97-26', '$103,204.'),
        vote_tally: 'Yes Yes Yes Yes Yes',
      }),
    ).toMatchObject({ failed: expect.stringContaining('vote tally') });
    expect(check({ record_ids: ['t'] })).toEqual({
      failed: 'cites no minutes or actions record it was given',
    });
  });

  it("checks the model's transcript window, and finds none for an item nobody discussed", () => {
    const base = { record_ids: ['m'], minutes_excerpt: hearing(), topic: 'Shoppes at Jupiter' };
    // A window at the call to order isn't about the hearing: code finds the marker instead.
    const wrong = verifyItem(
      item({ ...base, agenda_number: '9.', transcript_window: { start: 0, end: 900 } }),
      [minutes()],
      transcript(),
    );
    expect(wrong).toMatchObject({ transcript: { start: 19789, located: 'marker' } });
    // A window on the hearing is kept as the model gave it.
    const right = verifyItem(
      item({ ...base, transcript_window: { start: 19789, end: 30000 } }),
      [minutes()],
      transcript(),
    );
    expect(right).toMatchObject({ transcript: { start: 19789, end: 30000, located: 'model' } });
    // Without a number or a window, the item's rare words and numbers place it.
    const searched = locateWindow(transcript(), {
      ...base,
      agenda_number: null,
      transcript_window: null,
    })!;
    expect(searched.located).toBe('search');
    expect(searched.start).toBeLessThanOrEqual(19804);
    expect(searched.end).toBeGreaterThan(19804);
    // The holiday decorations contract was on the consent agenda: never discussed, no window.
    const consent = verifyItem(
      item({
        topic: 'Holiday decorations contract',
        agenda_number: '6.',
        record_ids: ['m'],
        minutes_excerpt: between(minutes().text!, '6. Resolution 97-26', '$103,204.'),
      }),
      [minutes()],
      transcript(),
    );
    expect(consent).toMatchObject({ transcript: null });
  });

  it('gives the writer the whole short minutes and only the stretch of transcript', () => {
    const checked = verifyItem(
      item({ agenda_number: '9.', record_ids: ['m'], minutes_excerpt: hearing() }),
      [minutes()],
      transcript(),
    ) as MeetingItem;
    expect(itemSourceText(minutes(), checked)).toBe(minutes().text);
    const window = itemSourceText(transcript(), checked);
    expect(window).toMatch(/^When: Tuesday, October 6, 2026, 7:00 PM\n/);
    expect(window).toContain('Machine-generated captions');
    expect(window).toContain('the rest of the meeting is left out');
    expect(window).toContain('[9. Resolution 72-26');
    expect(window).not.toContain('THE TIME IS NOW 7 P.M.');
    expect(window.length).toBeLessThan(25_000);
  });

  it('cuts long minutes around the item, keeping the meeting header', () => {
    const m = minutes();
    const long = {
      ...m,
      text: `${m.text}\n\n${'Filler line about other business.\n'.repeat(800)}`,
    };
    const checked = verifyItem(
      item({ record_ids: ['m'], minutes_excerpt: hearing() }),
      [long],
      null,
    ) as MeetingItem;
    const cut = itemSourceText(long, checked);
    expect(cut.length).toBeLessThan(long.text!.length);
    expect(cut).toMatch(/^When: Tuesday, October 6, 2026, 7:00 PM\n/);
    expect(cut).toContain('Councilor Guisinger moved to approve Resolution 72-26');
    expect(cut.endsWith('[…]')).toBe(true);
  });

  it('times a window from uploaded captions', () => {
    const header = 'Captions uploaded by staff.\n\n';
    const body = 'Call to order.\nItem nine: the Shoppes at Jupiter hearing.\nMotion carried.';
    const t = {
      id: 'u',
      type: 'transcript',
      title: 'Transcript',
      text: header + body,
      raw: { cues: { starts: [0, 65, 3600], offsets: [0, 15, 58] }, cueBase: header.length },
    };
    const w = locateWindow(t, {
      topic: 'Shoppes at Jupiter',
      agenda_number: null,
      minutes_excerpt: 'Shoppes at Jupiter hearing',
      transcript_window: { start: header.length + 15, end: header.length + 58 },
    })!;
    expect(w).toMatchObject({ located: 'model', startSeconds: 65, endSeconds: 3600 });
    expect(transcriptOutline(t)).toContain(`@${header.length + 15} [1:05] Item nine`);
  });
});

// ---------------------------------------------------------------------------------------------

describe('the story finder with the splitter', () => {
  const actions = () => raw(delray, 'actions:4630');
  const delrayItems = (id: string) => {
    const text = actions().text!;
    const denied = between(text, '7.A. RESOLUTION NO. 148-26', 'This Resolution was denied.');
    return [
      item({
        topic: 'Waivers for 1401 Dale Lane denied',
        agenda_number: '7.A.',
        outcome: 'denied',
        record_ids: [id],
        minutes_excerpt: denied,
        impact: 0.6,
        novelty: 0.9,
        proximity: 0.9,
      }),
      item({
        topic: 'Tennis center management contract',
        agenda_number: '7.F.',
        record_ids: [id],
        minutes_excerpt: between(
          text,
          '7.F. RESOLUTION NO. 107-26',
          'This Resolution was approved.',
        ),
        impact: 0.8,
      }),
      item({
        topic: 'Polymer supply contract',
        agenda_number: '6.E.',
        record_ids: [id],
        minutes_excerpt: between(
          text,
          '6.E. RESOLUTION NO. 134-26',
          'This Resolution was approved.',
        ),
        impact: 0.4,
        novelty: 0.2,
        proximity: 0.1,
      }),
      // Paraphrased: dropped.
      item({
        topic: 'Affordable housing land list',
        record_ids: [id],
        minutes_excerpt:
          '7.C. Resolution 164-26 approving the affordable housing list was approved.',
      }),
      // A tally the record never states: dropped.
      item({
        topic: 'Catherine Drive renamed',
        record_ids: [id],
        vote_tally: '5-0',
        minutes_excerpt: between(
          text,
          '7.D. RESOLUTION NO. 119-26',
          'This Resolution was approved.',
        ),
      }),
      // Procedural, with a real tally: checked, but not its own story.
      item({
        topic: 'Agenda approved',
        record_ids: [id],
        vote_tally: 'all were in favor',
        minutes_excerpt: between(text, '3. AGENDA APPROVAL', 'all were in favor'),
        newsworthy: false,
      }),
      // The denial again, as a second part of long minutes would see it: one story, not two.
      item({ topic: 'Dale Lane', record_ids: [id], minutes_excerpt: denied.slice(0, 200) }),
    ];
  };

  it('leaves meetings as one recap while the splitter is off (the default)', async () => {
    const minutes = await insert(raw(jupiter, 'minutes:1491'));
    const transcript = await insert(raw(jupiter, 'transcript:1491'));
    const { llm, seen } = stub({}, { on: false });
    const report = await runStoryFinder(db, townId, { llm, now: NOW });
    expect(seen.map((s) => s.prompt)).toEqual(['classify']);
    expect(report.meetingItems).toBe(0);
    const [c] = await all();
    expect(c).toMatchObject({ key: `record:${minutes.id}`, status: 'accepted' });
    expect(c!.recordIds).toEqual([minutes.id, transcript.id]);
    expect(meetingItemOf(c!.classification)).toBeNull();
  });

  it('splits a meeting with several newsworthy decisions into checked story candidates', async () => {
    const actionsRow = await insert(actions());
    const { llm, seen } = stub({ split: (input) => ({ items: delrayItems(recordIdIn(input)) }) });
    const report = await runStoryFinder(db, townId, { llm, now: NOW });

    expect(seen.map((s) => s.prompt)).toEqual(['classify', 'split']);
    expect(seen[1]!.input).toContain('=== No transcript for this meeting.');
    expect(report.meetingItems).toBe(3);
    const rows = await all();
    const parent = rows.find((r) => r.key === `record:${actionsRow.id}`)!;
    expect(parent.status).toBe('skipped');
    expect(parent.skip).toMatchObject({ reason: 'duplicate' });
    expect(parent.skip!.detail).toBe(
      'Split into 3 decision stories (meeting-split@v1): Polymer supply contract; Waivers for 1401 Dale Lane denied; Tennis center management contract.',
    );

    const items = rows.filter((r) => r.key.startsWith('meeting-item:'));
    expect(items.map((r) => r.key).sort()).toEqual(
      // In meeting order: 3 (the agenda, not news), then 6.E, 7.A and 7.F.
      [1, 2, 3].map((i) => `meeting-item:${actionsRow.id}:${i}`).sort(),
    );
    for (const r of items) {
      expect(r.recordIds).toEqual([actionsRow.id]);
      expect(r.kind).toBe('story');
      expect(r.status).toBe('accepted');
      expect(r.tierReasons).toContain('one of 3 decisions from a meeting (meeting-split@v1)');
      const it = meetingItemOf(r.classification)!;
      expect(actions().text!.slice(it.excerptStart, it.excerptEnd)).toBe(it.excerpt);
    }
    const denial = items.find((r) => r.title === 'Waivers for 1401 Dale Lane denied')!;
    expect(meetingItemOf(denial.classification)).toMatchObject({
      agendaNumber: '7.A.',
      outcome: 'denied',
      transcript: null,
      newsworthy: true,
    });
    // Each decision is scored on its own: the strong denial above the minor supply contract.
    const score = (t: string) => items.find((r) => r.title === t)!.newsworthiness!;
    expect(score('Waivers for 1401 Dale Lane denied')).toBeGreaterThan(
      score('Polymer supply contract'),
    );
    const scores = await db.select().from(articleScores);
    expect(
      scores.filter((s) => (s.components as { splitFrom?: string }).splitFrom === parent.id),
    ).toHaveLength(3);
  });

  it('the daily budget decides how many of them are written', async () => {
    await setConfig({ story_budget: 2 });
    await insert(actions());
    const { llm } = stub({ split: (input) => ({ items: delrayItems(recordIdIn(input)) }) });
    const report = await runStoryFinder(db, townId, { llm, now: NOW });
    expect(report.accepted).toBe(2);
    const items = (await all()).filter((r) => r.key.startsWith('meeting-item:'));
    expect(
      items
        .filter((r) => r.status === 'accepted')
        .map((r) => r.title)
        .sort(),
    ).toEqual(['Tennis center management contract', 'Waivers for 1401 Dale Lane denied']);
    expect(items.find((r) => r.status === 'skipped')!.skip).toMatchObject({
      reason: 'budget_full',
    });
  });

  it('keeps one recap when only one decision is newsworthy, or the splitter fails', async () => {
    const one = await insert(actions());
    const { llm } = stub({
      split: (input) => ({
        items: delrayItems(recordIdIn(input)).map((x, i) => ({ ...x, newsworthy: i === 0 })),
      }),
    });
    await runStoryFinder(db, townId, { llm, now: NOW });
    expect((await all()).map((r) => [r.key, r.status])).toEqual([[`record:${one.id}`, 'accepted']]);

    await db.delete(articleScores);
    await db.delete(storyCandidates);
    await db.delete(aiRequests);
    const broken = stub({ split: () => 'invalid' });
    await runStoryFinder(db, townId, { llm: broken.llm, now: NOW });
    // Invalid twice (it escalates once), then the meeting is written as one recap.
    expect(broken.seen.map((s) => s.prompt)).toEqual(['classify', 'split', 'split']);
    const [c] = await all();
    expect(c).toMatchObject({ key: `record:${one.id}`, status: 'accepted' });
    expect(c!.newsworthiness).not.toBeNull();
  });

  it('stops at the spend cap without losing the meeting, and picks it up next run', async () => {
    await setConfig({ ai_daily_call_cap: 1 });
    await insert(actions());
    const capped = stub({ split: (input) => ({ items: delrayItems(recordIdIn(input)) }) });
    const report = await runStoryFinder(db, townId, { llm: capped.llm, now: NOW });
    expect(report.capReached).toBe(true);
    expect(capped.seen.map((s) => s.prompt)).toEqual(['classify']);
    const [waiting] = await all();
    expect(waiting).toMatchObject({ status: 'pending', classification: null });

    await setConfig({ ai_daily_call_cap: 400 });
    const next = stub({ split: (input) => ({ items: delrayItems(recordIdIn(input)) }) });
    const again = await runStoryFinder(db, townId, { llm: next.llm, now: NOW });
    // The classify answer is reused at no cost; only the split is asked.
    expect(next.seen.map((s) => s.prompt)).toEqual(['split']);
    expect(again.meetingItems).toBe(3);
  });

  it('reads long minutes in overlapping parts and counts a decision seen twice once', async () => {
    const base = actions();
    const filler = Array.from(
      { length: 300 },
      (_, i) =>
        `- 9.${i}. REPORT ${i} ON A ROUTINE MATTER (Request, file 26-${2000 + i}): Received.`,
    ).join('\n');
    const long = await insert({
      ...base,
      externalId: 'actions:long',
      text: `${base.text}\n${filler}`,
    });
    const parts: string[] = [];
    const { llm } = stub({
      split: (input) => {
        parts.push(input);
        // Every part reports the decisions it can see, so the overlap repeats some.
        return {
          items: delrayItems(recordIdIn(input)).filter((x) =>
            input.includes(x.minutes_excerpt.slice(0, 60)),
          ),
        };
      },
    });
    const report = await runStoryFinder(db, townId, { llm, now: NOW });
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toMatch(/, part 1 of \d+\n/);
    expect(report.meetingItems).toBe(3);
    const keys = (await all()).map((r) => r.key).filter((k) => k.startsWith('meeting-item:'));
    expect(new Set(keys).size).toBe(3);
    expect(keys.every((k) => k.startsWith(`meeting-item:${long.id}:`))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------

describe('writing one decision', () => {
  it('sends the writer and fact-check only the decision’s stretch of transcript, then review', async () => {
    const minutes = await insert(raw(jupiter, 'minutes:1491'));
    const transcript = await insert(raw(jupiter, 'transcript:1491'));
    const text = minutes.text!;
    const hearing = between(text, '9. Resolution 72-26', 'motion passed.');
    const consent = between(text, '6. Resolution 97-26', '$103,204.');
    const body =
      'Councilor Guisinger moved to approve Resolution 72-26, as amended, for the Shoppes at Jupiter site plan amendment at 101 N. US Highway One, and the motion passed.';
    const { llm, seen } = stub({
      split: (input) => ({
        items: [
          item({
            topic: 'Shoppes at Jupiter site plan amendment',
            agenda_number: '9.',
            record_ids: [recordIdIn(input)],
            minutes_excerpt: hearing,
            vote_tally: 'motion passed',
            impact: 0.9,
          }),
          item({
            topic: 'Holiday decorations contract',
            agenda_number: '6.',
            record_ids: [recordIdIn(input)],
            minutes_excerpt: consent,
          }),
        ],
      }),
      writer: {
        headline: 'Council approves Shoppes at Jupiter site plan amendment',
        dek: 'The vote came at the Oct. 6 meeting.',
        body_md: body,
        beat: 'government',
        source_record_ids: [minutes.id, transcript.id],
        claims: [],
      },
      factcheck: {
        claims: [
          {
            claim: 'approved',
            record_id: minutes.id,
            quote: 'Councilor Guisinger moved to approve Resolution 72-26, as amended',
            supported: true,
          },
        ],
        wrong_town_risk: false,
        wrong_town_reason: null,
      },
    });
    await runStoryFinder(db, townId, { llm, now: NOW });
    const items = (await all()).filter((r) => r.key.startsWith('meeting-item:'));
    const hearingRow = items.find((r) => r.title === 'Shoppes at Jupiter site plan amendment')!;
    // The hearing was discussed on the video; the consent contract wasn't.
    expect(hearingRow.recordIds).toEqual([minutes.id, transcript.id]);
    expect(items.find((r) => r.title === 'Holiday decorations contract')!.recordIds).toEqual([
      minutes.id,
    ]);

    const outcome = await writeCandidate(db, hearingRow.id, { llm, now: NOW, random: () => 0.99 });
    const writer = seen.find((s) => s.prompt === 'writer')!.input;
    const check = seen.find((s) => s.prompt === 'factcheck')!.input;
    for (const input of [writer, check]) {
      expect(input).toContain('[9. Resolution 72-26');
      expect(input).toContain('the rest of the meeting is left out');
      expect(input).not.toContain('THE TIME IS NOW 7 P.M.');
      expect(input).toContain('Mayor Kuretski called the meeting to order'); // whole minutes
    }
    expect(writer).toContain(
      'This story covers one decision from the meeting: Shoppes at Jupiter site plan amendment',
    );
    // Machine captions can misspell names: a story citing one goes to a person (D-M2-4).
    expect(outcome).toMatchObject({ status: 'in_review', reason: 'transcript' });
    const [article] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, (outcome as { articleId: string }).articleId));
    expect(article!.promptVersions).toContain('meeting-split@v1');
    expect(article!.sourceRecordIds).toEqual([minutes.id, transcript.id]);
  });
});
