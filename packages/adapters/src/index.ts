// Source adapters, one folder per PLATFORM (CLAUDE.md §9), plus the ingest framework.
import './adapters';
export {
  Fetcher,
  FetchPolicyError,
  NotModified,
  OutsideVisitTime,
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
export { findAdapter, getAdapter, listAdapters, missingEnv, registerAdapter } from './registry';
export { defaultSchedule, intervalMs, isDue } from './schedule';
export type {
  AdapterContext,
  RawRecord,
  SourceAdapter,
  SourceConfig,
  SourceProposal,
} from './types';
export { DOCUMENTED_APIS, documentedApi } from './http/policy';
export { nwsAdapter } from './nws';
export { civicplusAdapter } from './civicplus';
export { legistarAdapter, legistarClient } from './legistar';
export { civicclerkAdapter, civicclerkTenant } from './civicclerk';
export { fetchSwagitTranscript, swagitVideo, tidyTranscript } from './swagit';
export { isoDurationSeconds, titleTime, youtubeAdapter, youtubeChannel } from './youtube';
export { extractPage, pageAdapter } from './page';
export { feedAdapter, feedLinks, htmlToText, pageText, parseFeed } from './feed';
export { parseIcal, zonedTimeToUtc } from './lib/ical';
export { flDbprAdapter } from './fl-dbpr';
export { foodViolations } from './fl-dbpr/violations';
export { flSunbizAdapter } from './fl-sunbiz';
export {
  alertsForTown,
  fetchWeather,
  fetchZoneAlerts,
  parsePoint,
  type ZoneAlert,
} from './nws/weather';
export { beachConfig, fetchBeach, parseSurfSegment, type BeachConfig } from './nws/beach';
export {
  censusPlaceAt,
  type PlaceAt,
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
export {
  cleanWebsite,
  extractPlaces,
  formatPhone,
  placeFromTags,
  type OsmPlace,
} from './osm/places';
export { parseCsvLine } from './lib/csv';
export {
  searchPhotos,
  trackDownload,
  UNSPLASH_LICENSE,
  UNSPLASH_LICENSE_URL,
  unsplashLink,
  type UnsplashPhoto,
} from './unsplash';
export { parseDatasetUrl, socrataAdapter, socrataDate } from './socrata';
export { arcgisAdapter, arcgisQueryUrl, arcgisRecords } from './arcgis';
export { escribeAdapter, escribeDate, escribeRecords } from './escribe';
