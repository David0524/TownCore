import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  fullInput,
  type BatchApi,
  type BatchResult,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from './types';

// Recorded model responses, the same idea as the adapters' HTTP fixtures: record once with a
// real key (`pnpm llm:record`), then tests replay the file and never call a model. The key
// ignores the model ID and the routing settings (effort, thinking, limits), so a recording
// works whichever provider and route is configured; the stable input prefix counts as part of
// the input, so splitting an input into prefix and rest keeps old recordings valid.

export type LlmFixtureFile = {
  recordedAt: string;
  provider: string;
  entries: Record<string, LlmResponse>;
};

export function requestKey(
  request: Pick<LlmRequest, 'system' | 'inputPrefix' | 'input' | 'schema'>,
): string {
  return createHash('sha256')
    .update(JSON.stringify([request.system, fullInput(request), request.schema]))
    .digest('hex')
    .slice(0, 24);
}

export class NotRecordedError extends Error {
  constructor() {
    super(
      'No recorded model response for this request. The prompt or input changed: re-record with llm:record.',
    );
  }
}

/**
 * Replays recorded responses. It can do whatever was recorded (web search, images); with
 * `batch`, batch requests are answered from the recording too, as a batch that has already
 * ended, so the batch path runs offline.
 */
export function replayProvider(
  fixture: LlmFixtureFile | string,
  opts: { batch?: boolean } = {},
): LlmProvider {
  const file: LlmFixtureFile =
    typeof fixture === 'string' ? JSON.parse(readFileSync(fixture, 'utf8')) : fixture;
  const lookup = (request: LlmRequest) => file.entries[requestKey(request)];
  const batches = new Map<string, Array<{ customId: string; request: LlmRequest }>>();
  const batch: BatchApi = {
    async submit(items) {
      const id = `replay_batch_${batches.size + 1}`;
      batches.set(id, items);
      return id;
    },
    async poll(batchId) {
      const results = new Map<string, BatchResult>();
      for (const item of batches.get(batchId) ?? []) {
        const entry = lookup(item.request);
        results.set(item.customId, entry ? { response: entry } : { error: 'not recorded' });
      }
      return { ended: true, results };
    },
  };
  return {
    name: 'replay',
    webSearch: true,
    images: true,
    ...(opts.batch ? { batch } : {}),
    async generate(request) {
      const entry = lookup(request);
      if (!entry) throw new NotRecordedError();
      return entry;
    },
  };
}

/** Wraps a real provider and keeps each response so it can be saved as a fixture. */
export function recordingProvider(real: LlmProvider): {
  provider: LlmProvider;
  save: (path: string) => void;
} {
  const entries: Record<string, LlmResponse> = {};
  return {
    provider: {
      name: real.name,
      webSearch: real.webSearch,
      images: real.images,
      async generate(request) {
        const response = await real.generate(request);
        entries[requestKey(request)] = response;
        return response;
      },
    },
    save(path) {
      mkdirSync(dirname(path), { recursive: true });
      const file: LlmFixtureFile = {
        recordedAt: new Date().toISOString(),
        provider: real.name,
        entries,
      };
      writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
    },
  };
}
