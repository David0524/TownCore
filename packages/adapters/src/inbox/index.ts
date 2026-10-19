import type { SourceAdapter } from '../types';

// Press releases sent to the newsroom inbox: their records are written when staff press "Send to
// newsroom" on a message in the shared inbox (packages/pipeline/src/press-releases.ts), so this
// source has nothing to fetch. It's registered so the worker treats the source as healthy
// instead of warning about a missing adapter.
export const inboxAdapter: SourceAdapter = {
  platform: 'inbox',
  kinds: ['city_news', 'police', 'fire', 'schools'],
  async detect() {
    return 0;
  },
  async fetch() {
    return [];
  },
  async healthCheck() {
    return { ok: true };
  },
};
