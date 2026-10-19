// Which open alerts are worth an email, and when (ported from the anomaly rules in Kyle's
// TownCore, lib/ops/anomaly-rules.ts). An alert that mails every day while nothing changes is one
// admins stop opening, so every condition says what kind of thing it is:
//
//   breakage  something is failing and returns to normal once fixed (a broken source on a live
//             town, a site down, the worker silent, a cap reached). Emailed when it opens, again
//             every 24 hours while open, and once when it resolves. The default.
//   backlog   a queue depth (stories waiting in review). Emailed only when it is both above its
//             ceiling AND deeper than a week ago (losing ground, not just busy), at most once a
//             week, because a queue moves too slowly to be worth a daily email.
//   standing  a true fact no daily action clears (a broken source on a town that isn't live yet).
//             Dashboard only: Admin → Health shows it; it is never emailed.
//
// Pure functions; packages/mail/src/ops/alerts.ts applies them when it sends.

export const alertKinds = ['breakage', 'backlog', 'standing'] as const;
export type AlertKind = (typeof alertKinds)[number];

/** A backlog's depth now, the depth that is worth an email, and its depth a week ago. */
export type Backlog = { depth: number; ceiling: number; weekAgo: number };

export const BREAKAGE_REPEAT_MS = 24 * 3_600_000;
export const BACKLOG_REPEAT_MS = 7 * 24 * 3_600_000;

/** Above its ceiling and deeper than a week ago. */
export function deepAndGrowing(b: Backlog): boolean {
  return b.depth >= b.ceiling && b.depth > b.weekAgo;
}

/** "+4 this week", "−2 this week", "flat this week". */
export function backlogTrend(b: Pick<Backlog, 'depth' | 'weekAgo'>): string {
  const net = b.depth - b.weekAgo;
  if (net === 0) return 'flat this week';
  return net > 0 ? `+${net} this week` : `−${Math.abs(net)} this week`;
}

/**
 * Whether an open alert goes in the email being built at `now`. `condition` is what the current
 * run reports for the alert's key (kind and backlog numbers); an alert no current condition
 * describes is treated as breakage, as every alert was before kinds existed.
 */
export function emailDue(
  condition: { kind?: AlertKind | undefined; backlog?: Backlog | undefined } | undefined,
  lastNotifiedAt: Date | null,
  now: Date,
): boolean {
  const since = lastNotifiedAt ? now.getTime() - lastNotifiedAt.getTime() : Infinity;
  switch (condition?.kind ?? 'breakage') {
    case 'standing':
      return false;
    case 'backlog':
      return (
        since >= BACKLOG_REPEAT_MS &&
        condition?.backlog !== undefined &&
        deepAndGrowing(condition.backlog)
      );
    case 'breakage':
      return since >= BREAKAGE_REPEAT_MS;
  }
}

/** How each kind reaches admins, for the dashboard. */
export const alertKindLabels: Record<AlertKind, string> = {
  breakage: 'Emailed daily while open',
  backlog: 'Emailed weekly when deep and growing',
  standing: 'Dashboard only',
};
