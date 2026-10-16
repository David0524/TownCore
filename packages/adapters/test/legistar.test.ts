import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Fetcher } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import {
  actionsText,
  eventStart,
  legistarAdapter,
  legistarClient,
  type LegistarEventItem,
} from '../src/legistar';
import type { SourceConfig } from '../src/types';

// Recorded live from webapi.legistar.com (Delray Beach, FL) on 2026-10-16.
const fixture = fileURLToPath(new URL('../fixtures/legistar/delray-events.json', import.meta.url));
const ctx = () => ({
  fetcher: new Fetcher({
    fetchImpl: replayFetch(fixture),
    sleep: async () => {},
    now: () => 0,
    minIntervalMs: 0,
  }),
  now: new Date('2026-10-16T12:00:00Z'),
});
const delray: SourceConfig = {
  id: 'legistar',
  townId: 't',
  kind: 'agenda',
  platform: 'legistar',
  url: 'https://delraybeach.legistar.com/',
  config: { timezone: 'America/New_York', pastDays: 14, aheadDays: 14 },
};

describe('legistar', () => {
  it('finds the client name and detects Legistar pages', async () => {
    expect(legistarClient('https://delraybeach.legistar.com/Calendar.aspx')).toBe('delraybeach');
    expect(legistarClient('https://webapi.legistar.com/v1/FortLauderdale/events')).toBe(
      'fortlauderdale',
    );
    expect(legistarClient('https://www.delraybeachfl.gov/')).toBeNull();
    expect(await legistarAdapter.detect('https://delraybeach.legistar.com/', '')).toBe(1);
    const cityPage =
      '<a href="https://delraybeach.legistar.com/Calendar.aspx">Agendas &amp; Minutes</a>';
    expect(await legistarAdapter.detect('https://www.delraybeachfl.gov/', cityPage)).toBe(0.8);
    expect(await legistarAdapter.detect('https://www.myboca.us/', '<p>Agendas</p>')).toBe(0);
  });

  it('reads local meeting times', () => {
    const tz = 'America/New_York';
    expect(eventStart({ EventDate: '2026-10-13T00:00:00', EventTime: '5:00 PM' }, tz)).toEqual({
      start: new Date('2026-10-13T21:00:00Z'),
      hasTime: true,
    });
    expect(
      eventStart({ EventDate: '2026-12-01T00:00:00', EventTime: '09:00 AM' }, tz).start,
    ).toEqual(new Date('2026-12-01T14:00:00Z'));
    expect(eventStart({ EventDate: '2026-10-13T00:00:00', EventTime: null }, tz).hasTime).toBe(
      false,
    );
  });

  it('turns meetings into meeting, agenda and actions records', async () => {
    const records = await legistarAdapter.fetch(delray, null, ctx());
    const meetings = records.filter((r) => r.type === 'meeting');
    expect(meetings).toHaveLength(9);

    // A meeting record is only the schedule, in the same shape as other calendars.
    const commission = records.find((r) => r.externalId === 'event:4630')!;
    expect(commission.title).toBe('City Commission: Regular Meeting');
    expect(commission.text).toMatch(/^When: Tuesday, October 13, 2026, 5:00 PM\nWhere: /);
    expect(commission.text).not.toMatch(/Agenda items/);
    expect(commission.occurredAt).toEqual(new Date('2026-10-13T21:00:00Z'));
    // Readers go to the meeting's page on the city's Legistar site, never the file hosts.
    expect(commission.url).toMatch(/^https:\/\/delraybeach\.legistar\.com\/MeetingDetail\.aspx\?/);
    for (const r of records) expect(r.url).not.toMatch(/legistar1\.com|granicus\.com/);

    const agenda = records.find((r) => r.externalId === 'agenda:4630')!;
    expect(agenda.type).toBe('agenda');
    expect(agenda.text).toContain('Agenda items:');
    expect(agenda.text).toMatch(/- 7\.A\. RESOLUTION NO\. 148-26: .* \(Resolution, file 26-1153\)/);
    expect(agenda.text).not.toMatch(/shall furnish appropriate auxiliary aids/i);

    // Actions are the clerk's own words, one line per item that has one.
    const actions = records.find((r) => r.externalId === 'actions:4630')!;
    expect(actions.type).toBe('meeting-actions');
    expect(actions.text).toMatch(
      /- 7\.A\. RESOLUTION NO\. 148-26: .*: This Resolution was denied\./,
    );
    // A meeting with no recorded actions yet has no actions record.
    expect(records.find((r) => r.externalId === 'actions:4453')).toBeUndefined();
    expect(records.find((r) => r.externalId === 'agenda:4453')).toBeDefined();
  });

  it('can limit a town to some bodies', async () => {
    const records = await legistarAdapter.fetch(
      { ...delray, config: { ...delray.config, bodies: ['City Commission'] } },
      null,
      ctx(),
    );
    expect(new Set(records.map((r) => (r.raw as { body: string }).body))).toEqual(
      new Set(['City Commission']),
    );
  });

  it('writes votes, movers and seconders when the clerk records them', () => {
    const item: LegistarEventItem = {
      EventItemId: 1,
      EventItemAgendaSequence: 1,
      EventItemAgendaNumber: '8.A.',
      EventItemTitle: 'ORDINANCE NO. 12-26: AMENDING  THE CODE',
      EventItemActionName: 'approved',
      EventItemActionText: null,
      EventItemPassedFlagName: 'Pass',
      EventItemTally: '4-1',
      EventItemMover: 'Jane Roe',
      EventItemSeconder: 'John Doe',
      EventItemConsent: 0,
      EventItemMatterId: 9,
      EventItemMatterFile: '26-1',
      EventItemMatterType: 'Ordinance',
      EventItemMatterStatus: 'Passed',
    };
    expect(actionsText([item])).toBe(
      '- 8.A. ORDINANCE NO. 12-26: AMENDING THE CODE (Ordinance, file 26-1): approved. Result: Pass. Vote: 4-1. Moved by Jane Roe, seconded by John Doe',
    );
  });

  it('health check asks the API for one body', async () => {
    const fetcher = new Fetcher({
      fetchImpl: replayFetch({
        recordedAt: '',
        exchanges: [
          { url: 'https://webapi.legistar.com/robots.txt', status: 404, headers: {}, body: '' },
          {
            url: 'https://webapi.legistar.com/v1/delraybeach/bodies?$top=1',
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: '[{"BodyId":1}]',
          },
        ],
      }),
      sleep: async () => {},
      now: () => 0,
      minIntervalMs: 0,
    });
    await expect(
      legistarAdapter.healthCheck(delray, { fetcher, now: new Date() }),
    ).resolves.toEqual({
      ok: true,
    });
  });
});
