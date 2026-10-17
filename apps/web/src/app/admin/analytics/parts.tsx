import {
  ANALYTICS_RANGES,
  lightLabels,
  type AnalyticsRange,
  type Light,
  type Uptime,
} from '@towncore/pipeline';
import styles from './analytics.module.css';

// Shared pieces of Admin → Analytics: number formats, the status light, stat tiles and the daily
// bar chart (one series, one hue; each bar names its day and value on hover, and a table view
// follows for screen readers and exact numbers).

export const rangeOf = (value: string | undefined): AnalyticsRange =>
  ANALYTICS_RANGES.find((r) => String(r) === value) ?? 30;

export const count = (n: number) => Math.round(n).toLocaleString('en-US');
export const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: cents % 100 ? 2 : 0 })}`;
export const pct = (share: number | null) =>
  share === null ? '–' : `${(share * 100).toFixed(share >= 0.9995 ? 0 : 1)}%`;
export function duration(seconds: number | null): string {
  if (seconds === null) return '–';
  const s = Math.round(seconds);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
export function age(days: number, live: boolean): string {
  const span =
    days < 1
      ? 'today'
      : days < 60
        ? `${days} day${days === 1 ? '' : 's'}`
        : days < 730
          ? `${Math.floor(days / 30.4)} months`
          : `${(days / 365).toFixed(1)} years`;
  return live
    ? days < 1
      ? 'Live since today'
      : `Live ${span}`
    : days < 1
      ? 'Set up today'
      : `Draft ${span}`;
}

const glyph: Record<Light, string> = { up: '●', slow: '▲', down: '■', unknown: '○' };

/** The light: a mark and a word, so it never depends on color alone. */
export function StatusLight({ uptime }: { uptime: Pick<Uptime, 'light' | 'why'> }) {
  return (
    <span className={styles.light} data-light={uptime.light} title={uptime.why}>
      <span className={styles.lightMark} aria-hidden="true">
        {glyph[uptime.light]}
      </span>
      {lightLabels[uptime.light]}
    </span>
  );
}

export function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className={styles.tile}>
      <div className={styles.tileLabel}>{label}</div>
      <div className={styles.tileValue}>{value}</div>
      {note ? <div className={styles.tileNote}>{note}</div> : null}
    </div>
  );
}

/** Daily bars for one measure. Days with no data are drawn as an empty slot, not a zero bar. */
export function DailyBars({
  title,
  points,
  format,
}: {
  title: string;
  points: Array<{ day: string; value: number | null }>;
  format: (n: number) => string;
}) {
  const max = Math.max(1, ...points.map((p) => p.value ?? 0));
  const w = 640;
  const h = 140;
  const gap = 2;
  const bw = Math.max(1, (w - gap * (points.length - 1)) / points.length);
  const total = points.reduce((n, p) => n + (p.value ?? 0), 0);
  return (
    <figure className={styles.chart}>
      <figcaption className={styles.chartTitle}>
        {title}
        <span className={styles.muted}> · peak {format(max)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h + 18}`} role="img" aria-label={`${title}, daily`}>
        <line x1="0" x2={w} y1={h} y2={h} className={styles.axis} />
        {points.map((p, i) => {
          const v = p.value ?? 0;
          const bh = p.value === null ? 0 : Math.max(v > 0 ? 2 : 0, (v / max) * (h - 4));
          const x = i * (bw + gap);
          return (
            <g key={p.day}>
              {/* A full-height hit area, so thin bars are easy to hover. */}
              <rect x={x} y={0} width={bw} height={h} className={styles.hit}>
                <title>{`${p.day}: ${p.value === null ? 'no data' : format(v)}`}</title>
              </rect>
              {bh > 0 ? (
                <rect
                  x={x}
                  y={h - bh}
                  width={bw}
                  height={bh}
                  rx={Math.min(2, bw / 2)}
                  className={styles.bar}
                />
              ) : null}
            </g>
          );
        })}
        <text x="0" y={h + 14} className={styles.tick}>
          {points[0]?.day}
        </text>
        <text x={w} y={h + 14} textAnchor="end" className={styles.tick}>
          {points.at(-1)?.day}
        </text>
      </svg>
      <details className={styles.tableView}>
        <summary>Table view</summary>
        <table className={styles.small}>
          <tbody>
            {points.map((p) => (
              <tr key={p.day}>
                <td>{p.day}</td>
                <td>{p.value === null ? '–' : format(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <span className="sr-only">Total {format(total)}</span>
    </figure>
  );
}
