import type { Town } from '@towncore/db';
import { clockTime } from './format';
import styles from './weather.module.css';

/** Today's sunset, computed from the town's coordinates (no outside data). */
export function SunsetTile({ town, sunset }: { town: Town; sunset: Date }) {
  return (
    <div className={styles.small} data-testid="sunset-tile">
      <span className={styles.smallLabel}>Sunset</span>
      <span className={styles.smallValue}>{clockTime(sunset, town.timezone)}</span>
    </div>
  );
}
