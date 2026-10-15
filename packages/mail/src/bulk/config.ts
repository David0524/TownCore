// Bulk mail settings (brief §7.2, §7.4; docs/plans/MAIL.md Mail-5). Kept as config, not
// scattered constants, so they can be tuned without touching the logic.

export const BULK_CONFIG = {
  warmup: {
    /** First day's cap for a new news. subdomain. */
    startCap: 50,
    /** The cap multiplies by this… */
    factor: 2,
    /** …after this many healthy days in a row. */
    stepDays: 3,
    /** Breach days in a row that step the ramp back one step (one day holds it). */
    stepBackAfter: 2,
  },
  autoPause: {
    /** Trailing window for per-domain and network rates. */
    windowDays: 7,
    /** No per-domain pause below this many sends in the window. */
    minSample: 100,
    domainBounceRate: 0.03,
    domainComplaintRate: 0.0008,
    /** Over all mail on the account; SES reviews at 5% / 0.1%. */
    networkBounceRate: 0.04,
    networkComplaintRate: 0.0008,
    networkMinSample: 500,
  },
  sending: {
    /** Across all towns; under the account's SES send rate. */
    messagesPerSecond: 10,
    batchSize: 50,
    /** A send left in 'sending' this long is given up as "outcome unknown", never retried. */
    staleSendingMs: 10 * 60_000,
  },
  signup: {
    perIpPerHour: 5,
    confirmEveryMs: 10 * 60_000,
    confirmPerDay: 3,
    confirmTtlMs: 7 * 24 * 3_600_000,
  },
} as const;

export type BulkConfig = typeof BULK_CONFIG;
