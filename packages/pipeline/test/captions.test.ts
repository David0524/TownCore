import { fileURLToPath } from 'node:url';
import { loadTowns } from '@towncore/config';
import {
  adminActions,
  aiRequests,
  aiUsage,
  articleScores,
  eq,
  getTownBySlug,
  records,
  skippedCandidates,
  sources,
  staff,
  storyCandidates,
  syncTowns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { classifyV1, meetingSplitV1 } from '@towncore/prompts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachCaptions, captionMeetings, CaptionUploadError } from '../src/captions';
import { runStoryFinder } from '../src/finder';
import type { Llm, LlmProvider } from '../src/llm';
import { meetingItemOf } from '../src/meeting-split';
import { classification } from './helpers';

// Captions staff upload for a meeting (Admin → Meetings): stored as the meeting's transcript,
// added to its recap, timed for the splitter.

const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));
const NOW = new Date('2026-10-14T15:00:00Z');
const MEETING_AT = new Date('2026-10-13T21:00:00Z');

let db: Db;
let drop: () => Promise<void>;
let townId: string;
let sourceId: string;
let staffId: string;

const MINUTES = [
  'When: Tuesday, October 13, 2026, 5:00 PM',
  'Body: City Commission',
  '',
  'Actions taken, as recorded by the clerk:',
  '- 7.A. RESOLUTION NO. 148-26 WAIVERS FOR 1401 DALE LANE (Resolution, file 26-1153): This Resolution was denied.',
  '- 7.F. RESOLUTION NO. 107-26 TENNIS CENTER MANAGEMENT WITH JCD SPORTS GROUP FOR $999,600 (Resolution, file 26-1309): This Resolution was approved.',
  ...Array.from({ length: 8 }, (_, i) => `- 8.${i}. A ROUTINE REPORT NUMBER ${i}: Received.`),
].join('\n');

/** A Zoom-style VTT: a minute of chatter, then the Dale Lane item at 1:05:00. */
function vtt(): string {
  const cues: string[] = ['WEBVTT', ''];
  let t = 0;
  const at = (s: number) =>
    `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.000`;
  const say = (text: string, gap = 20) => {
    cues.push(`${at(t)} --> ${at(t + gap)}`, `<v Clerk>${text}</v>`, '');
    t += gap;
  };
  for (let i = 0; i < 30; i++) say(`Discussion of routine business, part ${i}, continues here.`);
  t = 3900;
  say('Next is item seven A, the waivers for fourteen oh one Dale Lane.');
  say('The applicant asks for lot coverage of thirty four point nine percent on Dale Lane.');
  say('Motion to deny the Dale Lane waivers. The motion carries.');
  t = 5400;
  say('Item seven F is the tennis center management agreement with JCD Sports Group.');
  return cues.join('\n');
}

async function meeting(over: Partial<typeof records.$inferInsert> = {}) {
  const [m] = await db
    .insert(records)
    .values({
      sourceId,
      townId,
      externalId: 'event:4630',
      type: 'meeting',
      title: 'City Commission',
      text: 'When: Tuesday, October 13, 2026, 5:00 PM\nWhere: City Hall\nBody: City Commission',
      url: 'https://delraybeach.legistar.com/MeetingDetail.aspx?ID=4630',
      occurredAt: MEETING_AT,
      contentHash: 'm',
      ...over,
    })
    .returning();
  return m!;
}

async function actions() {
  const [a] = await db
    .insert(records)
    .values({
      sourceId,
      townId,
      externalId: 'actions:4630',
      type: 'meeting-actions',
      title: 'Actions: City Commission',
      text: MINUTES,
      occurredAt: MEETING_AT,
      contentHash: 'a',
    })
    .returning();
  return a!;
}

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  const loaded = loadTowns(townsDir).filter((t) => t.config.slug === 'boca-raton');
  await syncTowns(
    db,
    loaded.map((t) => ({ ...t, config: { ...t.config, sources: [] } })),
  );
  townId = (await getTownBySlug(db, 'boca-raton'))!.id;
  const [s] = await db
    .insert(sources)
    .values({ townId, kind: 'agenda', platform: 'legistar', adapter: 'legistar', key: 'meetings' })
    .returning();
  sourceId = s!.id;
  const [st] = await db
    .insert(staff)
    .values({ email: 'ed@towncore.net', name: 'Ed', role: 'reviewer' })
    .returning();
  staffId = st!.id;
});
afterAll(async () => drop());
beforeEach(async () => {
  await db.delete(adminActions);
  await db.delete(skippedCandidates);
  await db.delete(articleScores);
  await db.delete(storyCandidates);
  await db.delete(records);
  await db.delete(aiUsage);
  await db.delete(aiRequests);
});

describe('caption uploads', () => {
  it("stores the file as the meeting's transcript, timed, and adds it to the waiting recap", async () => {
    const m = await meeting();
    const a = await actions();
    const [recap] = await db
      .insert(storyCandidates)
      .values({
        townId,
        kind: 'story',
        key: `record:${a.id}`,
        title: a.title,
        beat: 'government',
        recordIds: [a.id],
        proposedTier: 2,
        status: 'accepted',
      })
      .returning();

    const out = await attachCaptions(db, {
      meetingRecordId: m.id,
      fileName: 'commission.vtt',
      content: vtt(),
      staffId,
      now: NOW,
    });
    expect(out).toMatchObject({ format: 'vtt', cues: 34, recaps: 1 });

    const [t] = await db.select().from(records).where(eq(records.id, out.recordId));
    expect(t).toMatchObject({
      sourceId,
      externalId: 'transcript-upload:4630',
      type: 'transcript',
      title: 'Transcript: City Commission',
      occurredAt: MEETING_AT,
    });
    expect(t!.text).toMatch(
      /^When: Tuesday, October 13, 2026, 5:00 PM\nWhere: City Hall\nBody: City Commission\nCaptions uploaded by staff \(commission\.vtt\)\.\nCaptions: wording is approximate and names may be misspelled\.\n\nDiscussion of routine business, part 0/,
    );
    expect(t!.text).not.toContain('<v Clerk>');
    const raw = t!.raw as { cues: { starts: number[] }; cueBase: number; uploaded: boolean };
    expect(raw.uploaded).toBe(true);
    expect(raw.cues.starts.slice(-4)).toEqual([3900, 3920, 3940, 5400]);
    expect(t!.text!.slice(raw.cueBase).startsWith('Discussion of routine business')).toBe(true);

    const [after] = await db
      .select()
      .from(storyCandidates)
      .where(eq(storyCandidates.id, recap!.id));
    expect(after!.recordIds).toEqual([a.id, out.recordId]);
    const [audit] = await db.select().from(adminActions);
    expect(audit).toMatchObject({
      staffId,
      action: 'meeting.captions',
      targetType: 'record',
      targetId: out.recordId,
    });

    const listed = await captionMeetings(db, { now: NOW });
    expect(listed).toEqual([
      expect.objectContaining({
        id: m.id,
        hasResults: true,
        transcript: { id: out.recordId, uploaded: true },
      }),
    ]);
  });

  it('refuses files it cannot use, and a meeting that already has a transcript', async () => {
    const m = await meeting();
    const up = (over: Partial<Parameters<typeof attachCaptions>[1]>) =>
      attachCaptions(db, {
        meetingRecordId: m.id,
        fileName: 'c.vtt',
        content: vtt(),
        staffId,
        now: NOW,
        ...over,
      });
    await expect(up({ fileName: 'c.docx' })).rejects.toThrow('Upload a .vtt, .srt or .txt');
    await expect(up({ content: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi.' })).rejects.toThrow(
      /Only 3 characters/,
    );
    await expect(up({ content: 'x'.repeat(5_000_001) })).rejects.toThrow('too large');
    await expect(up({ meetingRecordId: '00000000-0000-0000-0000-000000000000' })).rejects.toThrow(
      'not found',
    );
    const future = await meeting({
      externalId: 'event:9999',
      occurredAt: new Date('2026-11-01T21:00:00Z'),
    });
    await expect(up({ meetingRecordId: future.id })).rejects.toBeInstanceOf(CaptionUploadError);

    await up({});
    await expect(up({})).rejects.toThrow('already has a transcript');
    // A platform transcript (Swagit) counts too.
    const other = await meeting({ externalId: 'event:77' });
    await db.insert(records).values({
      sourceId,
      townId,
      externalId: 'transcript:77',
      type: 'transcript',
      text: 'x',
      contentHash: 't',
    });
    await expect(up({ meetingRecordId: other.id })).rejects.toThrow('already has a transcript');
    expect(await db.select().from(adminActions)).toHaveLength(1);
  });

  it('reads a plain .txt transcript with no times', async () => {
    const m = await meeting();
    const text = 'Call to order.\n' + 'The commission discussed the budget at length.\n'.repeat(20);
    const out = await attachCaptions(db, {
      meetingRecordId: m.id,
      fileName: 'minutes-transcript.txt',
      content: text,
      staffId,
      now: NOW,
    });
    expect(out).toMatchObject({ format: 'text', cues: 0, recaps: 0 });
    const [t] = await db.select().from(records).where(eq(records.id, out.recordId));
    expect((t!.raw as { cues?: unknown }).cues).toBeUndefined();
  });

  it('the splitter places each decision on the uploaded video’s clock', async () => {
    const m = await meeting();
    await attachCaptions(db, {
      meetingRecordId: m.id,
      fileName: 'commission.vtt',
      content: vtt(),
      staffId,
      now: NOW,
    });
    const a = await actions();
    const splitInputs: string[] = [];
    const provider: LlmProvider = {
      name: 'replay',
      async generate(request) {
        const usage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0 };
        const model = 'gemini-flash-lite-latest';
        if (request.system === classifyV1.system) {
          const c = classification({ impact: 0.9, novelty: 0.9, proximity: 0.9 });
          return { text: JSON.stringify(c), stop: 'end', model, usage };
        }
        expect(request.system).toBe(meetingSplitV1.system);
        splitInputs.push(request.input);
        const id = request.input.match(/^--- Record (\S+)/m)![1]!;
        const line = (from: string) =>
          MINUTES.split('\n')
            .find((l) => l.includes(from))!
            .slice(2);
        const base = {
          agenda_number: null,
          vote_tally: null,
          record_ids: [id],
          transcript_window: null,
          newsworthy: true,
          impact: 0.8,
          novelty: 0.8,
          proximity: 0.8,
          reason: 'r',
        };
        // Like a model reading the outline: from the 1:05:00 line to the next time.
        const at = (clock: string) =>
          Number(request.input.match(new RegExp(`@(\\d+) \\[${clock}\\]`))![1]);
        const items = [
          {
            ...base,
            topic: 'Dale Lane waivers',
            outcome: 'denied',
            minutes_excerpt: line('7.A.'),
            transcript_window: { start: at('1:05:00'), end: at('1:30:00') },
          },
          {
            ...base,
            topic: 'Tennis center management',
            outcome: 'approved',
            minutes_excerpt: line('7.F.'),
          },
        ];
        return { text: JSON.stringify({ items }), stop: 'end', model, usage };
      },
    };
    const llm: Llm = {
      db,
      provider,
      providerName: 'gemini',
      now: () => NOW,
      routeOverrides: { 'meeting-split': { disabled: false } },
    };
    const report = await runStoryFinder(db, townId, { llm, now: NOW });
    expect(report.meetingItems).toBe(2);
    // The splitter saw times, not words.
    expect(splitInputs[0]).toMatch(/\n@\d+ \[1:05:00\] Next is item seven A/);
    expect(splitInputs[0]).not.toContain('The applicant asks for lot coverage');
    const items = (await db.select().from(storyCandidates)).filter((c) =>
      c.key.startsWith(`meeting-item:${a.id}:`),
    );
    const dale = meetingItemOf(items.find((c) => c.title === 'Dale Lane waivers')!.classification)!;
    expect(dale.transcript).toMatchObject({
      located: 'model',
      startSeconds: 3900,
      endSeconds: 5400,
    });
    // The tennis item has no window from the model: code finds it by its words.
    const tennis = items.find((c) => c.title === 'Tennis center management')!;
    const window = meetingItemOf(tennis.classification)!.transcript!;
    expect(window.located).toBe('search');
    expect(tennis.recordIds).toEqual([a.id, window.recordId]);
  });
});
