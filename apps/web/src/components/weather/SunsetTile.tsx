import type { Town } from '@towncore/db';
import { windShort } from './BeachTiles';
import { clockTime } from './format';
import styles from './weather.module.css';

/** Today's sunset, computed from the town's coordinates (no outside data), with the hour's wind. */
export function SunsetTile({
  town,
  sunset,
  wind,
}: {
  town: Town;
  sunset: Date;
  wind?: { windDirection: string; windSpeed: string } | null;
}) {
  const windNote = windShort(wind);
  return (
    <div className={styles.beachTile} data-testid="sunset-tile">
      <span className={styles.smallLabel}>Sunset</span>
      <span className={styles.smallValue}>{clockTime(sunset, town.timezone)}</span>
      {windNote ? <span className={styles.beachNote}>Wind {windNote}</span> : null}
    </div>
  );
}
