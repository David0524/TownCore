// Every queue the worker knows about. Pipeline queues are created now so M2+ only add handlers.
export const queues = {
  heartbeat: 'system.heartbeat',
  ingest: 'ingest',
  storyFinder: 'story-finder',
  writer: 'writer',
  factCheck: 'fact-check',
  newsletter: 'newsletter',
} as const;

export type QueueName = (typeof queues)[keyof typeof queues];

// Cron schedules (UTC). Per-town schedules (ingest, newsletter send time) are added in M2/M5.
export const schedules = [{ queue: queues.heartbeat, cron: '* * * * *' }] as const;
