import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { streamLines } from '../lib/csv';

// Statewide files, downloaded once and shared by every town (rollout Phase 1, owner 2026-10-17).
// A state's license, filing and inspection files are the same for each of its towns; each town's
// source used to download them and keep its city's rows, so 295 Florida towns meant 295
// downloads of one file. The worker keeps one Fetcher, and this cache in it: a file is fetched at
// most once per freshness window (a conditional GET when the window ends), kept on disk, and each
// town's source reads its own rows from that copy. Every town still gets its own run, health and
// dedupe; only the download is shared.

export type SharedFile = {
  status: number;
  /** The server's Last-Modified, when it sent one. */
  lastModified: Date | null;
  /** The whole body (a 200 only). */
  bytes(): Promise<Uint8Array>;
  /** The body line by line (a 200 only). */
  lines(): AsyncGenerator<string>;
  /**
   * True when a source that last ran at `since` has already read this version, so it can skip
   * it. Conservative: a copy can be up to `maxAgeMs` old when a source reads it, so a version
   * only counts as seen once it predates `since` by that much; anything newer is read again
   * (re-reading is harmless, since records dedupe by external ID and content hash).
   */
  seenBy(since: Date | null): boolean;
};

export type SharedFileOptions = {
  headers?: Record<string, string>;
  /** Reuse a copy for this long before asking the server again (default 6 hours). */
  maxAgeMs?: number;
  /** Reuse a "not there" (404) answer for this long (default 30 minutes). */
  missingMaxAgeMs?: number;
};

export const SHARED_MAX_AGE_MS = 6 * 3_600_000;
export const SHARED_MISSING_MAX_AGE_MS = 30 * 60_000;

type Entry = {
  status: number;
  lastModified: Date | null;
  etag: string | null;
  checkedAt: number;
  maxAgeMs: number;
  path: string | null;
  /** The copy this one replaced: deleted at the next replacement, so a source still reading it
   * isn't cut off. */
  previousPath: string | null;
};

type Get = (url: string, headers: Record<string, string>) => Promise<Response>;

export class SharedFiles {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<Entry>>();
  private dir: Promise<string> | null = null;
  private count = 0;

  constructor(
    private readonly get: Get,
    private readonly now: () => number,
  ) {}

  async file(url: string, options: SharedFileOptions = {}): Promise<SharedFile> {
    const maxAgeMs = options.maxAgeMs ?? SHARED_MAX_AGE_MS;
    let entry = this.entries.get(url);
    if (!entry || this.now() - entry.checkedAt >= entry.maxAgeMs) {
      // Jobs asking for the same file at once share one download.
      let job = this.pending.get(url);
      if (!job) {
        job = this.refresh(url, entry, options, maxAgeMs).finally(() => this.pending.delete(url));
        this.pending.set(url, job);
      }
      entry = await job;
    }
    return view(entry, maxAgeMs);
  }

  private async refresh(
    url: string,
    previous: Entry | undefined,
    options: SharedFileOptions,
    maxAgeMs: number,
  ): Promise<Entry> {
    const conditional: Record<string, string> = {};
    if (previous?.status === 200 && previous.path) {
      if (previous.etag) conditional['if-none-match'] = previous.etag;
      if (previous.lastModified)
        conditional['if-modified-since'] = previous.lastModified.toUTCString();
    }
    const response = await this.get(url, { ...(options.headers ?? {}), ...conditional });
    const checkedAt = this.now();
    if (response.status === 304 && previous) {
      await response.body?.cancel();
      const kept = { ...previous, checkedAt, maxAgeMs };
      this.entries.set(url, kept);
      return kept;
    }
    if (!response.ok) {
      await response.body?.cancel();
      const failed: Entry = {
        status: response.status,
        lastModified: null,
        etag: null,
        checkedAt,
        maxAgeMs: options.missingMaxAgeMs ?? SHARED_MISSING_MAX_AGE_MS,
        path: null,
        previousPath: previous?.path ?? null,
      };
      // A missing file (a weekend's daily file) is remembered briefly; other errors aren't, so
      // the next source tries again.
      if (response.status === 404) {
        await this.drop(previous?.previousPath);
        this.entries.set(url, failed);
      }
      return failed;
    }
    const path = join(await this.directory(), `file-${++this.count}`);
    await writeFile(path, new Uint8Array(await response.arrayBuffer()));
    await this.drop(previous?.previousPath);
    const modified = response.headers.get('last-modified');
    const fresh: Entry = {
      status: 200,
      lastModified: modified && !Number.isNaN(Date.parse(modified)) ? new Date(modified) : null,
      etag: response.headers.get('etag'),
      checkedAt,
      maxAgeMs,
      path,
      previousPath: previous?.path ?? null,
    };
    this.entries.set(url, fresh);
    return fresh;
  }

  private async drop(path: string | null | undefined) {
    if (path) await rm(path, { force: true });
  }

  private directory(): Promise<string> {
    this.dir ??= mkdtemp(join(tmpdir(), 'towncore-shared-'));
    return this.dir;
  }
}

function view(entry: Entry, maxAgeMs: number): SharedFile {
  const path = () => {
    if (entry.status !== 200 || !entry.path) throw new Error(`No body: HTTP ${entry.status}`);
    return entry.path;
  };
  return {
    status: entry.status,
    lastModified: entry.lastModified,
    async bytes() {
      return new Uint8Array(await readFile(path()));
    },
    async *lines() {
      const stream = Readable.toWeb(createReadStream(path())) as ReadableStream<Uint8Array>;
      yield* streamLines(stream);
    },
    seenBy(since) {
      return (
        entry.status === 200 &&
        since !== null &&
        entry.lastModified !== null &&
        entry.lastModified.getTime() <= since.getTime() - maxAgeMs
      );
    },
  };
}
