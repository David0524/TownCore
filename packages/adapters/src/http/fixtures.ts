import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FetchFn } from './fetcher';

// Recorded HTTP fixtures (CLAUDE.md §9). Adapters are recorded once against the live source,
// then every test replays the recording, so tests and CI never touch the network.

export type Exchange = {
  url: string;
  status: number;
  headers: Record<string, string>;
  body?: string;
  bodyBase64?: string;
};
export type FixtureFile = { recordedAt: string; exchanges: Exchange[] };

const TEXT_TYPES = /json|xml|text|html|csv|javascript/i;

/** A fetch that serves recorded responses in order per URL, and fails loudly on anything else. */
export function replayFetch(fixture: FixtureFile | string): FetchFn {
  const file: FixtureFile =
    typeof fixture === 'string' ? JSON.parse(readFileSync(fixture, 'utf8')) : fixture;
  const queues = new Map<string, Exchange[]>();
  for (const exchange of file.exchanges) {
    queues.set(exchange.url, [...(queues.get(exchange.url) ?? []), exchange]);
  }
  return async (input) => {
    const queue = queues.get(input);
    const exchange = queue && (queue.length > 1 ? queue.shift() : queue[0]);
    if (!exchange)
      throw new Error(`No recorded fixture for ${input}. Re-record with fixtures:record.`);
    const body = exchange.bodyBase64
      ? Buffer.from(exchange.bodyBase64, 'base64')
      : (exchange.body ?? '');
    return new Response(body, { status: exchange.status, headers: exchange.headers });
  };
}

/** Wraps a real fetch and keeps every exchange so it can be saved as a fixture. */
export function recordingFetch(real: FetchFn): { fetch: FetchFn; save: (path: string) => void } {
  const exchanges: Exchange[] = [];
  return {
    fetch: async (input, init) => {
      const response = await real(input, init);
      const buffer = Buffer.from(await response.arrayBuffer());
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        if (['content-type', 'etag', 'last-modified'].includes(key)) headers[key] = value;
      });
      const isText = TEXT_TYPES.test(headers['content-type'] ?? 'text/plain');
      exchanges.push({
        url: input,
        status: response.status,
        headers,
        ...(isText ? { body: buffer.toString('utf8') } : { bodyBase64: buffer.toString('base64') }),
      });
      return new Response(buffer, { status: response.status, headers: response.headers });
    },
    save: (path) => {
      mkdirSync(dirname(path), { recursive: true });
      const file: FixtureFile = { recordedAt: new Date().toISOString(), exchanges };
      writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
    },
  };
}
