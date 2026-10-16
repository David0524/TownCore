// Source adapters, one folder per PLATFORM (CLAUDE.md §9), plus the ingest framework.
import './adapters';
export {
  Fetcher,
  FetchPolicyError,
  NotModified,
  type FetchFn,
  type FetcherOptions,
} from './http/fetcher';
export { recordingFetch, replayFetch, type FixtureFile } from './http/fixtures';
export { isBlockedUrl, USER_AGENT } from './http/policy';
export {
  BROKEN_AFTER_FAILURES,
  contentHash,
  ingestSource,
  listIngestableSources,
  toSourceConfig,
  type IngestResult,
} from './ingest';
export { findAdapter, getAdapter, listAdapters, registerAdapter } from './registry';
export { defaultSchedule, intervalMs, isDue } from './schedule';
export type { AdapterContext, RawRecord, SourceAdapter, SourceConfig } from './types';
export { DOCUMENTED_APIS, documentedApi } from './http/policy';
export { nwsAdapter } from './nws';
export { civicplusAdapter } from './civicplus';
export { parseIcal, zonedTimeToUtc } from './lib/ical';
export { flDbprAdapter } from './fl-dbpr';
export { flSunbizAdapter } from './fl-sunbiz';
export { fetchWeather, parsePoint } from './nws/weather';
export { beachConfig, fetchBeach, parseSurfSegment, type BeachConfig } from './nws/beach';
export {
  geocodeAddress,
  geocodeUrl,
  type GeocodeInput,
  type GeocodeResult,
} from './census/geocoder';
export {
  bboxAround,
  classifyWay,
  downloadTo,
  extractBasemap,
  extractBasemaps,
  geofabrikStateUrl,
  OSM_ATTRIBUTION,
  OSM_COPYRIGHT_URL,
  OSM_LICENSE,
  simplify,
  type BasemapClass,
  type BasemapLine,
  type Bbox,
} from './osm/basemap';
export { pbfFileFrames } from './osm/pbf';
