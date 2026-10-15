// Backoff for the DNS and SES APIs (brief §7.1: bulk onboarding must run unattended across
// hundreds of domains). Retries throttling and server errors, honoring Retry-After.

export type RetryOptions = {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export class RetryableError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = 6, baseMs = 1_000, maxMs = 60_000, sleep = defaultSleep } = options;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof RetryableError) || attempt >= attempts) throw error;
      const backoff = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      const jitter = Math.random() * backoff * 0.2;
      await sleep(Math.min(maxMs, Math.max(error.retryAfterMs ?? 0, backoff + jitter)));
    }
  }
}
