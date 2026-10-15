// Every queue the worker knows about. Pipeline queues are created now so M2+ only add handlers.
export const queues = {
  heartbeat: 'system.heartbeat',
  ingestTick: 'ingest.tick',
  ingest: 'ingest',
  storyFinder: 'story-finder',
  writer: 'writer',
  factCheck: 'fact-check',
  newsletter: 'newsletter',
} as const;

export type QueueName = (typeof queues)[keyof typeof queues];

// Cron schedules (UTC). Per-source ingest timing lives on each source, not in pg-boss crons.
export const schedules = [
  { queue: queues.heartbeat, cron: '* * * * *' },
  // Every 5 minutes, enqueue an ingest job for each source that is due (docs/plans/M2.md §4).
  { queue: queues.ingestTick, cron: '*/5 * * * *' },
] as const;
