import type { SourceAdapter } from '../types';

// Reader-sent scores (owner, 2026-10-17): their records are written when staff approve a report
// (packages/pipeline/src/scores.ts), so this source has nothing to fetch. It's registered so the
// worker treats the source as healthy instead of warning about a missing adapter.
export const readerAdapter: SourceAdapter = {
  platform: 'reader',
  kinds: ['sports'],
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
