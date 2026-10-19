import { createHash } from 'node:crypto';
import { cueIndex, parseCaptions } from '@towncore/adapters';
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  logAdminAction,
  lte,
  records,
  sql,
  storyCandidates,
  towns,
  type Db,
} from '@towncore/db';
import { MEETING_RESULT_TYPES } from './meeting-split';

// Meeting captions staff upload (Admin → Meetings): a caption file (WebVTT, SRT or text) that
// the town publishes for its own meeting video, or a recording's own export (Zoom, Teams),
// becomes that meeting's transcript record, the same kind of companion record as a Swagit
// transcript. No paid transcription and no caption scraping (D-M2-4): staff add only files they
// may use. Like any transcript, it's never a story's only source, it's left out of
// classification, and a story citing it goes to review (write.ts).

/** Caption files above this size are refused (a long meeting's VTT is about 1 MB). */
export const CAPTION_MAX_BYTES = 5_000_000;
/** Too little text to help a recap. */
export const CAPTION_MIN_CHARS = 400;
/** Transcript text kept at most; a longer file is refused rather than cut. */
export const CAPTION_MAX_CHARS = 200_000;
/** Meetings listed for upload: the past this many days. */
export const CAPTION_MEETING_DAYS = 45;

export class CaptionUploadError extends Error {}

const meetingId = (externalId: string) => externalId.split(':').slice(1).join(':');

export type CaptionMeeting = {
  id: string;
  title: string | null;
  siteName: string;
  timezone: string;
  occurredAt: Date | null;
  url: string | null;
  /** Minutes or recorded actions are in, so a recap can be written. */
  hasResults: boolean;
  /** Its transcript, if it has one: from the platform, or uploaded. */
  transcript: { id: string; uploaded: boolean } | null;
};

/** Past meetings in every town, newest first, with whether each has results and a transcript. */
export async function captionMeetings(
  db: Db,
  opts: { now?: Date; days?: number; limit?: number } = {},
): Promise<CaptionMeeting[]> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.days ?? CAPTION_MEETING_DAYS) * 86_400_000);
  const meetings = await db
    .select({ record: records, siteName: towns.siteName, timezone: towns.timezone })
    .from(records)
    .innerJoin(towns, eq(records.townId, towns.id))
    .where(
      and(
        eq(records.type, 'meeting'),
        gte(records.occurredAt, since),
        lte(records.occurredAt, now),
      ),
    )
    .orderBy(desc(records.occurredAt))
    .limit(opts.limit ?? 80);
  if (!meetings.length) return [];
  const related = await db
    .select({
      sourceId: records.sourceId,
      externalId: records.externalId,
      type: records.type,
      id: records.id,
      raw: records.raw,
    })
    .from(records)
    .where(
      and(
        inArray(records.sourceId, [...new Set(meetings.map((m) => m.record.sourceId))]),
        inArray(records.type, [...MEETING_RESULT_TYPES, 'transcript']),
      ),
    );
  return meetings.map(({ record, siteName, timezone }) => {
    const id = meetingId(record.externalId);
    const mine = related.filter(
      (r) => r.sourceId === record.sourceId && meetingId(r.externalId) === id,
    );
    const transcript = mine.find((r) => r.type === 'transcript');
    return {
      id: record.id,
      title: record.title,
      siteName,
      timezone,
      occurredAt: record.occurredAt,
      url: record.url,
      hasResults: mine.some((r) => MEETING_RESULT_TYPES.includes(r.type)),
      transcript: transcript
        ? {
            id: transcript.id,
            uploaded: Boolean((transcript.raw as { uploaded?: boolean })?.uploaded),
          }
        : null,
    };
  });
}

/**
 * Stores an uploaded caption file as the meeting's transcript record
 * (`transcript-upload:<meeting>` on the meeting's own source, beside where the adapters put
 * theirs) and adds it to any recap of that meeting not written yet. Audited.
 */
export async function attachCaptions(
  db: Db,
  input: {
    meetingRecordId: string;
    fileName: string;
    content: string;
    staffId: string;
    now?: Date;
  },
): Promise<{ recordId: string; format: string; cues: number; chars: number; recaps: number }> {
  const now = input.now ?? new Date();
  const [meeting] = await db
    .select()
    .from(records)
    .where(and(eq(records.id, input.meetingRecordId), eq(records.type, 'meeting')));
  if (!meeting) throw new CaptionUploadError('That meeting was not found.');
  if (meeting.occurredAt && meeting.occurredAt > now) {
    throw new CaptionUploadError('That meeting has not happened yet.');
  }
  if (!/\.(vtt|srt|txt)$/i.test(input.fileName)) {
    throw new CaptionUploadError('Upload a .vtt, .srt or .txt caption file.');
  }
  if (Buffer.byteLength(input.content, 'utf8') > CAPTION_MAX_BYTES) {
    throw new CaptionUploadError('That file is too large (5 MB at most).');
  }
  const id = meetingId(meeting.externalId);
  // Its own key, never the platform's: an adapter's later transcript can't overwrite it.
  const externalId = `transcript-upload:${id}`;
  const [existing] = await db
    .select({ id: records.id })
    .from(records)
    .where(
      and(
        eq(records.sourceId, meeting.sourceId),
        inArray(records.externalId, [`transcript:${id}`, externalId]),
      ),
    );
  if (existing) throw new CaptionUploadError('That meeting already has a transcript.');

  const parsed = parseCaptions(input.content, input.fileName);
  if (parsed.text.length < CAPTION_MIN_CHARS) {
    throw new CaptionUploadError(
      `Only ${parsed.text.length} characters of captions were read: check the file.`,
    );
  }
  if (parsed.text.length > CAPTION_MAX_CHARS) {
    throw new CaptionUploadError(
      'That transcript is too long to use (200,000 characters at most).',
    );
  }
  // The meeting's own lines (when, where, body) first, as on a platform transcript.
  const header = [
    ...(meeting.text ?? '').split('\n').filter((l) => /^(When|Where|Body):/.test(l)),
    `Captions uploaded by staff (${input.fileName}).`,
    'Captions: wording is approximate and names may be misspelled.',
    '',
    '',
  ].join('\n');
  const text = header + parsed.text;
  const [record] = await db
    .insert(records)
    .values({
      sourceId: meeting.sourceId,
      townId: meeting.townId,
      externalId,
      type: 'transcript',
      title: `Transcript: ${meeting.title ?? 'meeting'}`,
      text,
      url: meeting.url,
      occurredAt: meeting.occurredAt,
      raw: {
        uploaded: true,
        fileName: input.fileName,
        format: parsed.format,
        meetingRecordId: meeting.id,
        ...(parsed.cues.length ? { cues: cueIndex(parsed), cueBase: header.length } : {}),
      },
      contentHash: createHash('sha256').update(text).digest('hex'),
    })
    .onConflictDoNothing({ target: [records.sourceId, records.externalId] })
    .returning({ id: records.id });
  if (!record) throw new CaptionUploadError('That meeting already has a transcript.');

  // A recap of this meeting waiting to be written gets it too (the finder adds it to new ones).
  const results = await db
    .select({ id: records.id })
    .from(records)
    .where(
      and(
        eq(records.sourceId, meeting.sourceId),
        inArray(records.type, MEETING_RESULT_TYPES),
        inArray(records.externalId, [`minutes:${id}`, `actions:${id}`]),
      ),
    );
  let recaps = 0;
  if (results.length) {
    const updated = await db
      .update(storyCandidates)
      .set({ recordIds: sql`array_append(${storyCandidates.recordIds}, ${record.id}::uuid)` })
      .where(
        and(
          eq(storyCandidates.townId, meeting.townId),
          eq(storyCandidates.kind, 'story'),
          inArray(storyCandidates.status, ['pending', 'accepted']),
          inArray(
            storyCandidates.key,
            results.map((r) => `record:${r.id}`),
          ),
        ),
      )
      .returning({ id: storyCandidates.id });
    recaps = updated.length;
  }

  await logAdminAction(db, {
    staffId: input.staffId,
    action: 'meeting.captions',
    target: { type: 'record', id: record.id },
    detail: {
      meetingRecordId: meeting.id,
      fileName: input.fileName,
      format: parsed.format,
      cues: parsed.cues.length,
      chars: parsed.text.length,
      recaps,
    },
  });
  return {
    recordId: record.id,
    format: parsed.format,
    cues: parsed.cues.length,
    chars: parsed.text.length,
    recaps,
  };
}
