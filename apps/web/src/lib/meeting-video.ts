// Meeting videos on recaps (owner's decision, 2026-10-16). A story about a meeting shows that
// meeting's YouTube video as a click-to-play embed. The video comes from, in order:
//   1. a `meeting-video` record the story cites;
//   2. a YouTube link the meeting platform gives for the meeting (CivicClerk's video field);
//   3. a video on the town's channel (the `youtube` adapter) recorded the same local day, whose
//      title names the same body ("City Commission", or its acronym, "CRA") and, for a workshop
//      or regular meeting, the same kind. A video goes to one meeting only.
// Only videos whose owner allows embedding are embedded.

export type MeetingVideo = { videoId: string; title: string; channel: string | null };

type RecordLike = {
  type: string;
  title: string | null;
  occurredAt: Date | null;
  raw: unknown;
};

/** Record types about one meeting. */
const MEETING_TYPES = new Set(['meeting', 'agenda', 'minutes', 'meeting-actions', 'transcript']);
/** Words that don't tell two bodies apart. */
const STOP = new Set(['the', 'of', 'and', 'city', 'town', 'meeting', 'regular', 'special', 'a']);

/** The video ID in a YouTube URL (watch, youtu.be, embed or live), or null. */
export function youtubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www\.|m\.)/, '');
    const id =
      host === 'youtu.be'
        ? u.pathname.slice(1)
        : host === 'youtube.com' || host === 'youtube-nocookie.com'
          ? (u.searchParams.get('v') ?? u.pathname.match(/^\/(?:embed|live)\/([^/]+)/)?.[1])
          : null;
    return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** The body a meeting record is about: its stored body name, else its title without prefixes. */
export function meetingBody(record: RecordLike): string {
  const raw = (record.raw ?? {}) as { body?: string; category?: string };
  return (raw.body ?? raw.category ?? record.title ?? '')
    .replace(/^(agenda|minutes|actions|transcript):\s*/i, '')
    .replace(/:.*$/, '');
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));

const localDay = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(d);

/** Trailing nouns a body's acronym may leave out: "Planning and Zoning Board" is also "PZ". */
const GENERIC = new Set(['board', 'committee']);

/** Acronyms a body goes by: "Community Redevelopment Agency" → cra; "… Board" → also without B. */
export function bodyAcronyms(body: string): string[] {
  const parts = body
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w));
  if (parts.length < 2) return [];
  const full = parts.map((w) => w[0]).join('');
  const out = [full];
  if (parts.length > 2 && GENERIC.has(parts[parts.length - 1]!)) out.push(full.slice(0, -1));
  return out;
}

type Kind = 'workshop' | 'regular' | 'special' | null;
const kindOf = (s: string | null | undefined): Kind =>
  (s?.toLowerCase().match(/\b(workshop|regular|special)\b/)?.[1] as Kind) ?? null;

/** A meeting: when, which body, and its title when known (it gives the meeting's kind). */
export type MeetingRef = { at: Date; body: string; title?: string | null };

/**
 * How well a video fits a meeting, lower is better, or null if it can't be that meeting's: it
 * must be recorded the same local day, with every distinctive word of the body's name in its
 * title, or the body's acronym ("CRA"), so "Planning and Zoning Board" never matches "City
 * Commission". When the meeting is a workshop, regular or special meeting, a video titled as a
 * different kind is never it. Same kind first, then closest to the meeting's start.
 */
function fit(meeting: MeetingRef, video: RecordLike, timeZone: string): number | null {
  if (!video.occurredAt) return null;
  if (localDay(video.occurredAt, timeZone) !== localDay(meeting.at, timeZone)) return null;
  const body = words(meeting.body).filter((w) => w !== 'workshop');
  if (body.length === 0) return null;
  const acronyms = bodyAcronyms(meeting.body.replace(/\bworkshop\b/i, ''));
  const title = new Set(words(video.title ?? ''));
  if (!body.every((w) => title.has(w)) && !acronyms.some((a) => title.has(a))) return null;
  const kind = kindOf(meeting.title) ?? kindOf(meeting.body);
  const videoKind = kindOf(video.title);
  if (kind && videoKind && videoKind !== kind) return null;
  return (
    (kind && videoKind === kind ? 0 : 1) * 1e12 +
    Math.abs(video.occurredAt.getTime() - meeting.at.getTime())
  );
}

const sameBody = (a: MeetingRef, b: MeetingRef) =>
  words(a.body).join(' ') === words(b.body).join(' ');

/**
 * The channel video for a meeting (see `fit`). `others` are the town's other meetings around
 * that day: a video goes to one meeting only, so when a body meets twice in a day, the best
 * fitting meeting–video pairs are taken first and each meeting gets its own video.
 */
export function matchMeetingVideo(
  meeting: MeetingRef,
  videos: RecordLike[],
  timeZone: string,
  others: MeetingRef[] = [],
): RecordLike | null {
  // The same body's other meetings. A meeting's records (meeting, agenda, actions) share its
  // start, so the story's own meeting appears once.
  const meetings = [meeting];
  for (const m of others) {
    if (sameBody(m, meeting) && !meetings.some((x) => x.at.getTime() === m.at.getTime())) {
      meetings.push(m);
    }
  }
  const pairs: { m: number; v: RecordLike; score: number }[] = [];
  meetings.forEach((m, i) => {
    for (const v of videos) {
      const score = fit(m, v, timeZone);
      if (score !== null) pairs.push({ m: i, v, score });
    }
  });
  pairs.sort((a, b) => a.score - b.score || a.m - b.m);
  const takenMeetings = new Set<number>();
  const takenVideos = new Set<RecordLike>();
  for (const p of pairs) {
    if (takenMeetings.has(p.m) || takenVideos.has(p.v)) continue;
    if (p.m === 0) return p.v;
    takenMeetings.add(p.m);
    takenVideos.add(p.v);
  }
  return null;
}

function fromVideoRecord(record: RecordLike): MeetingVideo | null {
  const raw = (record.raw ?? {}) as {
    videoId?: string;
    channelTitle?: string | null;
    embeddable?: boolean;
  };
  if (!raw.videoId || raw.embeddable === false) return null;
  return {
    videoId: raw.videoId,
    title: record.title ?? 'Meeting video',
    channel: raw.channelTitle ?? null,
  };
}

/** A meeting record as the matcher sees it. */
function meetingRef(record: RecordLike): MeetingRef | null {
  return record.occurredAt
    ? { at: record.occurredAt, body: meetingBody(record), title: record.title }
    : null;
}

/**
 * The meeting video for a story's source records; `videos` are the town's channel videos and
 * `meetings` the town's meeting records around the same days (so a video goes to one meeting).
 */
export function pickMeetingVideo(
  sources: RecordLike[],
  videos: RecordLike[],
  timeZone: string,
  meetings: RecordLike[] = [],
): MeetingVideo | null {
  for (const record of sources) {
    if (record.type === 'meeting-video') {
      const video = fromVideoRecord(record);
      if (video) return video;
    }
  }
  const others = [...sources, ...meetings]
    .filter((r) => MEETING_TYPES.has(r.type))
    .map(meetingRef)
    .filter((m): m is MeetingRef => m !== null);
  for (const record of sources) {
    if (!MEETING_TYPES.has(record.type)) continue;
    const linked = youtubeVideoId((record.raw as { video?: string } | null)?.video);
    if (linked) {
      return { videoId: linked, title: record.title ?? 'Meeting video', channel: null };
    }
    const ref = meetingRef(record);
    if (!ref) continue;
    const match = matchMeetingVideo(ref, videos, timeZone, others);
    const video = match ? fromVideoRecord(match) : null;
    if (video) return video;
  }
  return null;
}
