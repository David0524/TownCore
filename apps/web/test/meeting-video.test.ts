import { describe, expect, it } from 'vitest';
import {
  bodyAcronyms,
  matchMeetingVideo,
  meetingBody,
  pickMeetingVideo,
  youtubeVideoId,
} from '../src/lib/meeting-video';

const tz = 'America/New_York';
const video = (title: string, at: string, over: Record<string, unknown> = {}) => ({
  type: 'meeting-video',
  title,
  occurredAt: new Date(at),
  raw: {
    videoId: `id-${title.length}`,
    channelTitle: 'City of Delray Beach',
    embeddable: true,
    ...over,
  },
});
const commission = video(
  'City Commission Regular Meeting - October 13, 2026',
  '2026-10-13T21:02:11Z',
);
const workshop = video('City Commission Workshop - October 13, 2026', '2026-10-13T19:31:00Z');
const pz = video('Planning and Zoning Board - October 13, 2026', '2026-10-13T21:05:00Z');
const actions = {
  type: 'meeting-actions',
  title: 'Actions: City Commission: Regular Meeting',
  occurredAt: new Date('2026-10-13T21:00:00Z'),
  raw: { body: 'City Commission' },
};

describe('meeting videos', () => {
  it('reads YouTube video IDs from every URL form', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ?start=86')).toBe(
      'dQw4w9WgXcQ',
    );
    expect(youtubeVideoId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://jupiterfl.new.swagit.com/videos/403164')).toBeNull();
    expect(youtubeVideoId('not a url')).toBeNull();
  });

  it("finds a body's name from the record", () => {
    expect(meetingBody(actions)).toBe('City Commission');
    expect(meetingBody({ ...actions, raw: null, title: 'Minutes: Town Council Meeting' })).toBe(
      'Town Council Meeting',
    );
  });

  it('matches the same body on the same local day, closest in time', () => {
    const at = new Date('2026-10-13T21:00:00Z');
    expect(matchMeetingVideo({ at, body: 'City Commission' }, [pz, workshop, commission], tz)).toBe(
      commission,
    );
    // A different body never matches, and neither does another day.
    expect(
      matchMeetingVideo({ at, body: 'Historic Preservation Board' }, [pz, commission], tz),
    ).toBeNull();
    const nextDay = video('City Commission Regular Meeting', '2026-10-15T21:00:00Z');
    expect(matchMeetingVideo({ at, body: 'City Commission' }, [nextDay], tz)).toBeNull();
  });

  it('takes the video of the same kind when a body meets twice in a day', () => {
    // The workshop record's time is closer to the regular meeting's video; its kind decides.
    const at = new Date('2026-10-13T21:00:00Z');
    const meeting = { at, body: 'City Commission', title: 'Agenda: City Commission: Workshop' };
    expect(matchMeetingVideo(meeting, [commission, workshop], tz)).toBe(workshop);
    // A regular meeting never takes a workshop video, even when it's the only one that day.
    const regular = { at, body: 'City Commission', title: 'Actions: City Commission: Regular' };
    expect(matchMeetingVideo(regular, [workshop], tz)).toBeNull();
  });

  it("matches a body's acronym in a video title", () => {
    expect(bodyAcronyms('Community Redevelopment Agency')).toEqual(['cra']);
    expect(bodyAcronyms('Site Plan Review and Appearance Board')).toEqual(['sprab', 'spra']);
    expect(bodyAcronyms('Planning and Zoning Board')).toEqual(['pzb', 'pz']);
    expect(bodyAcronyms('City Commission')).toEqual([]);
    const at = new Date('2026-10-13T22:00:00Z');
    const cra = video('CRA Board Meeting 10-13-2026 6:00 PM', '2026-10-13T22:00:00Z');
    const pzVideo = video('PZ Board Meeting 10-13-2026 6:00 PM', '2026-10-13T22:00:00Z');
    expect(
      matchMeetingVideo({ at, body: 'Community Redevelopment Agency' }, [pzVideo, cra], tz),
    ).toBe(cra);
    expect(matchMeetingVideo({ at, body: 'Planning and Zoning Board' }, [cra, pzVideo], tz)).toBe(
      pzVideo,
    );
  });

  it('prefers a cited video, then the platform link, then the channel; never a blocked embed', () => {
    expect(pickMeetingVideo([actions], [commission], tz)).toEqual({
      videoId: commission.raw.videoId,
      title: commission.title,
      channel: 'City of Delray Beach',
    });
    const cited = video('Board of Adjustment', '2026-10-01T21:00:00Z');
    expect(pickMeetingVideo([actions, cited], [commission], tz)?.videoId).toBe(cited.raw.videoId);
    const linked = { ...actions, raw: { video: 'https://www.youtube.com/watch?v=abcdefghijk' } };
    expect(pickMeetingVideo([linked], [], tz)?.videoId).toBe('abcdefghijk');
    const blocked = video('City Commission Regular Meeting', '2026-10-13T21:01:00Z', {
      embeddable: false,
    });
    expect(pickMeetingVideo([actions], [blocked], tz)).toBeNull();
    // A Swagit link is not a YouTube video; release-only stories get none.
    const swagit = { ...actions, raw: { video: 'https://jupiterfl.new.swagit.com/videos/1' } };
    expect(pickMeetingVideo([swagit], [], tz)).toBeNull();
    expect(pickMeetingVideo([{ ...actions, type: 'release' }], [commission], tz)).toBeNull();
  });
});
