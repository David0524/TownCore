import type { RawRecord, SourceAdapter, SourceConfig } from '../types';

// National Weather Service (CLAUDE.md §9: federal adapter, written once, reused by every US town).
// Uses the documented API at api.weather.gov (Rule 8 documented-API exception). One source per
// forecast zone: the zone forecast plus watches, warnings and advisories for that zone.

const API = 'https://api.weather.gov';
const GEOJSON = { accept: 'application/geo+json' };

type ZoneForecast = {
  properties: {
    updated: string;
    periods: Array<{ number: number; name: string; detailedForecast: string }>;
  };
};
type Alerts = {
  features: Array<{
    properties: {
      id: string;
      event: string;
      headline: string | null;
      description: string | null;
      instruction: string | null;
      sent: string;
      status: string;
      messageType: string;
      severity: string;
      areaDesc: string;
      web?: string | null;
      ends?: string | null;
      expires?: string | null;
    };
  }>;
};

function zoneOf(source: SourceConfig): string {
  const zone = source.config.zone;
  if (typeof zone !== 'string' || !/^[A-Z]{2}Z\d{3}$/.test(zone)) {
    throw new Error(
      `NWS source ${source.id} needs config.zone like "FLZ168", got ${JSON.stringify(zone)}`,
    );
  }
  return zone;
}

/** Human-readable NWS page for the zone, used as the record's source link. */
export function zonePageUrl(zone: string): string {
  return `https://forecast.weather.gov/MapClick.php?zoneid=${zone}`;
}

export const nwsAdapter: SourceAdapter = {
  platform: 'nws',
  kinds: ['weather'],

  async detect(url) {
    const host = new URL(url).hostname;
    return host === 'api.weather.gov' || host.endsWith('.weather.gov') ? 1 : 0;
  },

  async fetch(source, since, { fetcher }) {
    const zone = zoneOf(source);
    const records: RawRecord[] = [];

    const forecast = await fetcher.getJson<ZoneForecast>(
      `${API}/zones/forecast/${zone}/forecast`,
      GEOJSON,
    );
    const { updated, periods } = forecast.properties;
    records.push({
      // One record per forecast issuance; re-fetching the same issuance is a no-op.
      externalId: `forecast:${zone}:${updated}`,
      type: 'forecast',
      title: `Zone forecast for ${zone}`,
      text: periods.map((p) => `${p.name}: ${p.detailedForecast}`).join('\n'),
      url: zonePageUrl(zone),
      occurredAt: new Date(updated),
      raw: forecast.properties,
    });

    // Recent alerts (active and expired) so short-lived warnings aren't missed between runs.
    const alerts = await fetcher.getJson<Alerts>(`${API}/alerts?zone=${zone}&limit=50`, GEOJSON);
    for (const { properties: alert } of alerts.features) {
      if (alert.status !== 'Actual') continue; // skip Test/Exercise/System messages
      const sent = new Date(alert.sent);
      if (since && sent < since) continue;
      records.push({
        externalId: alert.id,
        type: 'alert',
        title: alert.headline ?? alert.event,
        text: [alert.description, alert.instruction].filter(Boolean).join('\n\n'),
        url: alert.web || zonePageUrl(zone),
        occurredAt: sent,
        raw: alert,
      });
    }
    return records;
  },

  async healthCheck(source, { fetcher }) {
    try {
      await fetcher.getJson(`${API}/zones/forecast/${zoneOf(source)}`, GEOJSON);
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  },
};
