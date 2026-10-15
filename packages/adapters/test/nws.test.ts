import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Fetcher } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import { nwsAdapter, zonePageUrl } from '../src/nws';
import type { SourceConfig } from '../src/types';

// Recorded live from api.weather.gov for Boca Raton's zone (FLZ168, Coastal Palm Beach County).
const fixture = fileURLToPath(new URL('../fixtures/nws/boca-flz168.json', import.meta.url));
const source: SourceConfig = {
  id: 's1',
  townId: 't1',
  kind: 'weather',
  platform: 'nws',
  url: null,
  config: { zone: 'FLZ168' },
};
const fetcher = () =>
  new Fetcher({
    fetchImpl: replayFetch(fixture),
    sleep: async () => {},
    now: () => 0,
    minIntervalMs: 0,
  });
const ctx = () => ({ fetcher: fetcher(), now: new Date() });

describe('nws adapter', () => {
  it('returns the zone forecast as one record per issuance', async () => {
    const records = await nwsAdapter.fetch(source, null, ctx());
    const forecast = records.find((r) => r.type === 'forecast')!;
    expect(forecast.externalId).toMatch(/^forecast:FLZ168:\d{4}-\d{2}-\d{2}T/);
    expect(forecast.text).toMatch(/^\w[\w ]*: .+/);
    expect(forecast.url).toBe(zonePageUrl('FLZ168'));
    expect(forecast.occurredAt).toBeInstanceOf(Date);
  });

  it('returns actual alerts with their headline, text and NWS ID', async () => {
    const alerts = (await nwsAdapter.fetch(source, null, ctx())).filter((r) => r.type === 'alert');
    expect(alerts.length).toBeGreaterThan(0);
    for (const alert of alerts) {
      expect(alert.externalId).toMatch(/^urn:oid:/);
      expect(alert.title).toBeTruthy();
      expect((alert.raw as { status: string }).status).toBe('Actual');
    }
  });

  it('skips alerts sent before the last successful run', async () => {
    const all = (await nwsAdapter.fetch(source, null, ctx())).filter((r) => r.type === 'alert');
    const newest = Math.max(...all.map((a) => a.occurredAt!.getTime()));
    const later = (await nwsAdapter.fetch(source, new Date(newest + 1), ctx())).filter(
      (r) => r.type === 'alert',
    );
    expect(later).toEqual([]);
  });

  it('rejects a source without a valid zone', async () => {
    await expect(nwsAdapter.fetch({ ...source, config: {} }, null, ctx())).rejects.toThrow(/zone/);
  });

  it('detects weather.gov URLs', async () => {
    expect(await nwsAdapter.detect('https://api.weather.gov/zones/forecast/FLZ168', '')).toBe(1);
    expect(await nwsAdapter.detect('https://www.myboca.us/', '')).toBe(0);
  });
});
