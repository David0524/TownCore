import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  civicclerkAdapter,
  civicclerkTenant,
  eventStart,
  eventsUrl,
  tidyText,
} from '../src/civicclerk';
import { Fetcher } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import type { SourceConfig } from '../src/types';

// Recorded live from jupiterfl.api.civicclerk.com (Town of Jupiter, FL) on 2026-10-16.
const fixture = fileURLToPath(
  new URL('../fixtures/civicclerk/jupiter-events.json', import.meta.url),
);
const NOW = new Date('2026-10-16T12:00:00Z');
const ctx = () => ({
  fetcher: new Fetcher({
    fetchImpl: replayFetch(fixture),
    sleep: async () => {},
    now: () => 0,
    minIntervalMs: 0,
  }),
  now: NOW,
});
const jupiter: SourceConfig = {
  id: 'civicclerk',
  townId: 't',
  kind: 'agenda',
  platform: 'civicclerk',
  url: 'https://jupiterfl.portal.civicclerk.com/',
  config: { timezone: 'America/New_York', pastDays: 14, aheadDays: 21 },
};

describe('civicclerk', () => {
  it('finds the tenant and detects CivicClerk pages', async () => {
    expect(civicclerkTenant('https://jupiterfl.portal.civicclerk.com/event/1491/overview')).toBe(
      'jupiterfl',
    );
    expect(civicclerkTenant('https://DeerfieldBeachFL.api.civicclerk.com/v1/Events')).toBe(
      'deerfieldbeachfl',
    );
    expect(civicclerkTenant('https://www.jupiter.fl.us/')).toBeNull();
    expect(await civicclerkAdapter.detect('https://jupiterfl.portal.civicclerk.com/', '')).toBe(1);
    const page = '<a href="https://jupiterfl.portal.civicclerk.com/">Agendas</a>';
    expect(await civicclerkAdapter.detect('https://www.jupiter.fl.us/', page)).toBe(0.8);
    expect(await civicclerkAdapter.detect('https://www.jupiter.fl.us/', '<p>hi</p>')).toBe(0);
  });

  it('reads the API times as local wall-clock times', () => {
    // Jupiter's agenda says 7:00 PM for a meeting the API lists as 19:00:00Z.
    expect(eventStart('2026-10-06T19:00:00Z', 'America/New_York')).toEqual(
      new Date('2026-10-06T23:00:00Z'),
    );
    expect(eventStart('2026-12-01T19:00:00Z', 'America/New_York')).toEqual(
      new Date('2026-12-02T00:00:00Z'),
    );
    expect(eventsUrl('jupiterfl', NOW, NOW, 'America/New_York')).toContain(
      'startDateTime+gt+2026-10-16T08%3A00%3A00Z',
    );
  });

  it('turns meetings into meeting, agenda and minutes records', async () => {
    const records = await civicclerkAdapter.fetch(jupiter, null, ctx());
    expect(records.filter((r) => r.type === 'meeting')).toHaveLength(11);

    const council = records.find((r) => r.externalId === 'event:1491')!;
    expect(council.title).toBe('Town Council Meeting');
    expect(council.text).toBe(
      [
        'When: Tuesday, October 6, 2026, 7:00 PM',
        'Where: 210 Military Trl, Jupiter, FL 33458',
        'Body: Town Council',
        'Video: https://jupiterfl.new.swagit.com/videos/403164',
      ].join('\n'),
    );
    expect(council.occurredAt).toEqual(new Date('2026-10-06T23:00:00Z'));
    expect(council.url).toBe('https://jupiterfl.portal.civicclerk.com/event/1491/overview');

    const agenda = records.find((r) => r.externalId === 'agenda:1491')!;
    expect(agenda.type).toBe('agenda');
    expect(agenda.text).toMatch(/^When: Tuesday, October 6, 2026, 7:00 PM\n/);
    expect(agenda.text).toContain('Proclaiming October 5–9, 2026 as "Customer Service Week"');
    const minutes = records.find((r) => r.externalId === 'minutes:1491')!;
    expect(minutes.type).toBe('minutes');
    expect(minutes.text).toContain('Mayor Kuretski called the meeting to order at 7:00 P.M.');

    // Agenda packets are never downloaded; a meeting with no files has only its meeting record.
    expect(records.some((r) => (r.raw as { fileName?: string }).fileName?.match(/packet/i))).toBe(
      false,
    );
    expect(records.filter((r) => r.externalId.endsWith(':1590'))).toHaveLength(1);
  });

  it('fetches a file only when it was published since the last run', async () => {
    const records = await civicclerkAdapter.fetch(jupiter, new Date('2026-10-10T00:00:00Z'), ctx());
    // Oct. 6 agenda (published Sept. 29) is skipped; its Oct. 7 minutes too; later files come.
    expect(records.find((r) => r.externalId === 'agenda:1491')).toBeUndefined();
    expect(records.find((r) => r.externalId === 'minutes:1491')).toBeUndefined();
    expect(records.find((r) => r.externalId === 'event:1491')).toBeDefined();
    expect(records.find((r) => r.externalId === 'minutes:1560')).toBeDefined();
  });

  it("adds a past meeting's Swagit transcript, never a missing one", async () => {
    const records = await civicclerkAdapter.fetch(jupiter, null, ctx());
    const transcript = records.find((r) => r.externalId === 'transcript:1491')!;
    expect(transcript.type).toBe('transcript');
    expect(transcript.url).toBe('https://jupiterfl.new.swagit.com/videos/403164');
    expect(transcript.text).toMatch(/^When: Tuesday, October 6, 2026, 7:00 PM\n/);
    expect(transcript.text).toContain('Machine-generated captions');
    expect(transcript.text).toContain('THE TIME IS NOW 7 P.M.');
    // Timestamps are dropped; the clerk's agenda markers stay.
    expect(transcript.text).not.toMatch(/^\[\d{2}:\d{2}:\d{2}\]$/m);
    expect(transcript.text).toContain('[1. Proclaiming October 5–9, 2026');
    // The Oct. 13 transcript wasn't posted yet (HTTP 204); upcoming meetings have none.
    expect(records.find((r) => r.externalId === 'transcript:1560')).toBeUndefined();
    expect(records.find((r) => r.externalId === 'transcript:1504')).toBeUndefined();
    // After the first run, only the last week's meetings are asked for.
    const later = await civicclerkAdapter.fetch(jupiter, new Date('2026-10-15T00:00:00Z'), ctx());
    expect(later.find((r) => r.type === 'transcript')).toBeUndefined();
  });

  it('tidies the plain-text layout', () => {
    expect(tidyText('   AGENDA \r\n   TOWN   OF JUPITER\n\n\n\n1.  Item ')).toBe(
      'AGENDA\nTOWN OF JUPITER\n\n1. Item',
    );
  });
});

describe('civicclerk discovery (launcher, M7)', () => {
  it('proposes the tenant’s meetings from its portal or a town page linking to it', async () => {
    const { civicclerkAdapter } = await import('../src/civicclerk');
    const ctx = { fetcher: new Fetcher(), now: new Date('2026-10-16T12:00:00Z') };
    expect(
      await civicclerkAdapter.propose!(
        'https://jupiterfl.portal.civicclerk.com/',
        '',
        'agenda',
        ctx,
      ),
    ).toEqual([
      {
        kind: 'agenda',
        url: 'https://jupiterfl.portal.civicclerk.com/',
        label: 'CivicClerk meetings (jupiterfl.portal.civicclerk.com, public API)',
      },
    ]);
    const town = '<a href="https://parklandfl.portal.civicclerk.com/">Meetings</a>';
    expect(
      (await civicclerkAdapter.propose!('https://www.example.gov/', town, 'agenda', ctx))[0]!.url,
    ).toBe('https://parklandfl.portal.civicclerk.com/');
  });
});
