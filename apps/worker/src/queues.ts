// Every queue the worker knows about. Pipeline queues are created now so M2+ only add handlers.
export const queues = {
  heartbeat: 'system.heartbeat',
  ingestTick: 'ingest.tick',
  ingest: 'ingest',
  storyFinderTick: 'story-finder.tick',
  storyFinder: 'story-finder',
  writer: 'writer',
  factCheck: 'fact-check',
  newsletter: 'newsletter',
  mailTick: 'mail.tick',
  bulkHealth: 'mail.bulk-health',
  weather: 'weather.refresh',
  directorySeed: 'directory.seed',
  directoryGeocode: 'directory.geocode',
  proofReports: 'directory.proof-reports',
  basemaps: 'maps.basemaps',
  maps: 'maps.draw',
  photos: 'photos.stock',
  facebook: 'social.facebook',
} as const;

export type QueueName = (typeof queues)[keyof typeof queues];

// Cron schedules (UTC). Per-source ingest timing lives on each source, not in pg-boss crons.
export const schedules = [
  { queue: queues.heartbeat, cron: '* * * * *' },
  // Every 5 minutes, enqueue an ingest job for each source that is due (docs/plans/M2.md §4).
  { queue: queues.ingestTick, cron: '*/5 * * * *' },
  // Every 30 minutes, run the story finder for each town that isn't paused (CLAUDE.md §6).
  { queue: queues.storyFinderTick, cron: '*/30 * * * *' },
  // Every 5 minutes, check mail domains waiting on SES and any "Re-check" requests (Mail-1).
  { queue: queues.mailTick, cron: '*/5 * * * *' },
  // Every 15 minutes, bulk auto-pause checks and the daily warm-up step (Mail-5).
  { queue: queues.bulkHealth, cron: '*/15 * * * *' },
  // Every 15 minutes, refresh each town's Today weather tile from NWS (docs/plans/M4b.md).
  { queue: queues.weather, cron: '*/15 * * * *' },
  // Every 5 minutes, build and send each town's daily issue once its local send time passes (M5).
  { queue: queues.newsletter, cron: '*/5 * * * *' },
  // Daily, rebuild each town's directory from its state license records (M6).
  { queue: queues.directorySeed, cron: '20 9 * * *' },
  // Every 15 minutes, geocode pending listings at the Census Geocoder's polite pace (M6).
  { queue: queues.directoryGeocode, cron: '*/15 * * * *' },
  // Hourly, email last month's proof report to paying businesses on the 1st–3rd (D-M6-10);
  // once per business and month.
  { queue: queues.proofReports, cron: '7 * * * *' },
  // Monthly (the 3rd, 07:40 UTC), rebuild town base maps from Geofabrik's state extracts (M4 E).
  { queue: queues.basemaps, cron: '40 7 3 * *' },
  // Every 30 minutes, give recent development and public-safety stories block-level maps.
  { queue: queues.maps, cron: '*/30 * * * *' },
  // Every 30 minutes (offset from maps), stock photos for new or rewritten guides (§11c).
  { queue: queues.photos, cron: '15,45 * * * *' },
  // Hourly, each live town's Facebook posts for the day; staff post them from Admin → Facebook.
  { queue: queues.facebook, cron: '25 * * * *' },
] as const;
