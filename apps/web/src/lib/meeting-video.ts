// Meeting videos on recaps (owner's decision, 2026-10-16). A story about a meeting shows that
// meeting's YouTube video as a click-to-play embed. The video comes from, in order:
//   1. a `meeting-video` record the story cites;
//   2. a YouTube link the meeting platform gives for the meeting (CivicClerk's video field);
//   3. a video on the town's channel (the `youtube` adapter) recorded the same local day, whose
//      title names the same body ("City Commission", or its acronym, "CRA") and, for a workshop
//      or regular meeting, the same kind.
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

/**
 * The channel video for a meeting: recorded the same local day, with every distinctive word of
 * the body's name in its title, or the body's acronym ("CRA"), so "Planning and Zoning Board"
 * never matches "City Commission". When the meeting is a workshop, regular or special meeting,
 * a video titled as a different kind is never it (a body can meet twice in a day).
 */
export function matchMeetingVideo(
  meeting: { at: Date; body: string; title?: string | null },
  videos: RecordLike[],
  timeZone: string,
): RecordLike | null {
  const day = localDay(meeting.at, timeZone);
  const body = words(meeting.body).filter((w) => w !== 'workshop');
  if (body.length === 0) return null;
  const acronyms = bodyAcronyms(meeting.body.replace(/\bworkshop\b/i, ''));
  const kind = kindOf(meeting.title) ?? kindOf(meeting.body);
  const candidates = videos.filter((v) => {
    if (!v.occurredAt || localDay(v.occurredAt, timeZone) !== day) return false;
    const title = new Set(words(v.title ?? ''));
    if (!body.every((w) => title.has(w)) && !acronyms.some((a) => title.has(a))) return false;
    const videoKind = kindOf(v.title);
    return !kind || !videoKind || videoKind === kind;
  });
  // Same kind first, then closest to the meeting's start.
  const score = (v: RecordLike) =>
    (kind && kindOf(v.title) === kind ? 0 : 1) * 1e12 +
    Math.abs(v.occurredAt!.getTime() - meeting.at.getTime());
  candidates.sort((a, b) => score(a) - score(b));
  return candidates[0] ?? null;
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

/** The meeting video for a story's source records; `videos` are the town's channel videos. */
export function pickMeetingVideo(
  sources: RecordLike[],
  videos: RecordLike[],
  timeZone: string,
): MeetingVideo | null {
  for (const record of sources) {
    if (record.type === 'meeting-video') {
      const video = fromVideoRecord(record);
      if (video) return video;
    }
  }
  for (const record of sources) {
    if (!MEETING_TYPES.has(record.type)) continue;
    const linked = youtubeVideoId((record.raw as { video?: string } | null)?.video);
    if (linked) {
      return { videoId: linked, title: record.title ?? 'Meeting video', channel: null };
    }
    if (!record.occurredAt) continue;
    const match = matchMeetingVideo(
      { at: record.occurredAt, body: meetingBody(record), title: record.title },
      videos,
      timeZone,
    );
    const video = match ? fromVideoRecord(match) : null;
    if (video) return video;
  }
  return null;
}
