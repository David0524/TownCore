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
] as const;
