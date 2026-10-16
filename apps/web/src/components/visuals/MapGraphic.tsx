import { MAP_VIEW, type MapSpec } from '@towncore/config';
import styles from './visuals.module.css';

/**
 * A block-level street map (CLAUDE.md §11c; D-M4-1), drawn from our OpenStreetMap base map in
 * the town's colors. The marked circle is the block, never an exact address. The alt text is
 * the accessible name; the drawing itself is hidden from screen readers.
 */
export function MapGraphic({ spec, alt }: { spec: MapSpec; alt: string }) {
  const { width, height } = MAP_VIEW;
  const { marker } = spec;
  return (
    <div className={styles.map} role="img" aria-label={alt} data-visual="map">
      <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
        <rect width={width} height={height} className={styles.mapGround} />
        {(['water', 'coast', 'minor', 'secondary', 'major'] as const).map((c) =>
          spec.lines
            .filter((l) => l.c === c)
            .map((l, i) => <path key={`${c}-${i}`} d={l.d} className={styles[`map_${c}`]} />),
        )}
        {spec.labels.map((l) => (
          <text
            key={l.text}
            x={l.x}
            y={l.y}
            transform={`rotate(${l.angle} ${l.x} ${l.y})`}
            className={styles.mapLabel}
          >
            {l.text}
          </text>
        ))}
        <circle cx={marker.x} cy={marker.y} r={marker.r} className={styles.mapArea} />
        <circle cx={marker.x} cy={marker.y} r={6} className={styles.mapDot} />
      </svg>
      <span className={styles.mapBlock} aria-hidden="true">
        {spec.label}
      </span>
    </div>
  );
}
