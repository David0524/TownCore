import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LlmProvider, LlmRequest, LlmResponse } from './types';

// Recorded model responses, the same idea as the adapters' HTTP fixtures: record once with a
// real key (`pnpm llm:record`), then tests replay the file and never call a model. The key
// ignores the model ID, so a recording works whichever provider is configured.

export type LlmFixtureFile = {
  recordedAt: string;
  provider: string;
  entries: Record<string, LlmResponse>;
};

export function requestKey(request: Pick<LlmRequest, 'system' | 'input' | 'schema'>): string {
  return createHash('sha256')
    .update(JSON.stringify([request.system, request.input, request.schema]))
    .digest('hex')
    .slice(0, 24);
}

export function replayProvider(fixture: LlmFixtureFile | string): LlmProvider {
  const file: LlmFixtureFile =
    typeof fixture === 'string' ? JSON.parse(readFileSync(fixture, 'utf8')) : fixture;
  return {
    name: 'replay',
    async generate(request) {
      const entry = file.entries[requestKey(request)];
      if (!entry) {
        throw new Error(
          'No recorded model response for this request. The prompt or input changed: re-record with llm:record.',
        );
      }
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
