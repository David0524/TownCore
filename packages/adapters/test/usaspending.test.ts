import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Fetcher, type FetchFn } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import type { SourceConfig } from '../src/types';
import { awardRecord, queryBody, usaspendingAdapter } from '../src/usaspending';

// Recorded live from api.usaspending.gov (documented API, no key; robots.txt 404) on
// 2026-10-17: new contracts and grants to recipients with a Boca Raton, FL address, Sept. 17 to
// Oct. 17, 2026.
const fixture = fileURLToPath(new URL('../fixtures/usaspending/boca-raton.json', import.meta.url));
const fetcherFor = (fetchImpl: FetchFn) =>
  new Fetcher({ fetchImpl, sleep: async () => {}, now: () => 0, minIntervalMs: 0 });
const source: SourceConfig = {
  id: 's',
  townId: 't',
  kind: 'federal_awards',
  platform: 'usaspending',
  url: null,
  config: { city: 'Boca Raton', state: 'FL' },
};
const NOW = new Date('2026-10-17T12:00:00Z');

describe('usaspending adapter', () => {
  it('turns new contracts and grants to town recipients into records', async () => {
    const records = await usaspendingAdapter.fetch(source, new Date('2026-10-01T00:00:00Z'), {
      fetcher: fetcherFor(replayFetch(fixture)),
      now: NOW,
    });
    expect(records.length).toBeGreaterThan(10);
    expect(new Set(records.map((r) => r.externalId)).size).toBe(records.length);
    const groups = new Set(records.map((r) => (r.raw as { group: string }).group));
    expect(groups).toEqual(new Set(['contract', 'grant']));
    for (const r of records) {
      expect(r.type).toBe('federal-award');
      expect(r.externalId).toMatch(/^award:(CONT|ASST)_/);
      expect(r.url).toMatch(/^https:\/\/www\.usaspending\.gov\/award\//);
      expect(r.text).toMatch(/^Recipient: .+\nAward type: (contract|grant)\nAmount: \d/);
      expect(r.text).toContain('Recipient address: Boca Raton, FL');
      // Dated by when the money was obligated, inside the window read.
      expect(r.occurredAt!.getTime()).toBeGreaterThanOrEqual(Date.parse('2026-09-17'));
    }
  });

  it('asks for new awards to the town, contracts and grants separately, biggest first', () => {
    const body = queryBody(
      { city: 'Boca Raton', state: 'FL', days: 30 },
      'grant',
      new Date('2026-09-01T00:00:00Z'),
      NOW,
    );
    expect(body.filters).toEqual({
      award_type_codes: ['02', '03', '04', '05'],
      recipient_locations: [{ country: 'USA', state: 'FL', city: 'Boca Raton' }],
      time_period: [
        { start_date: '2026-09-01', end_date: '2026-10-17', date_type: 'new_awards_only' },
      ],
    });
    expect(body).toMatchObject({ sort: 'Award Amount', order: 'desc' });
  });

  it('skips rows without an id or a date, and needs a city and state', async () => {
    expect(awardRecord({ 'Recipient Name': 'X' }, 'contract')).toBeNull();
    expect(
      awardRecord({ generated_internal_id: 'CONT_AWD_1', 'Start Date': 'soon' }, 'contract'),
    ).toBeNull();
    await expect(
      usaspendingAdapter.fetch({ ...source, config: { city: 'Boca Raton' } }, null, {
        fetcher: fetcherFor(replayFetch(fixture)),
        now: NOW,
      }),
    ).rejects.toThrow(/config.city and config.state/);
  });
});
