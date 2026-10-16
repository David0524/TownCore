import type { BeachConditions } from '@towncore/config';
import type { Town } from '@towncore/db';
import { clockTime } from './format';
import styles from './weather.module.css';

/** EPA's UV index categories. */
export function uvCategory(index: number): string {
  if (index <= 2) return 'Low';
  if (index <= 5) return 'Moderate';
  if (index <= 7) return 'High';
  if (index <= 10) return 'Very high';
  return 'Extreme';
}

/**
 * Small Today tiles for coastal towns (D-M4b-3): rip current risk and surf from the NWS surf zone
 * forecast, water temperature and the next tides from NOAA, and the EPA UV index. Each tile shows
 * only when its source answered; one line names every source, as each asks.
 */
export function BeachTiles({
  town,
  beach,
  sunset,
}: {
  town: Town;
  beach: BeachConditions;
  /** Today's sunset, shown as a tile in the same grid. */
  sunset: Date | null;
}) {
  const { surf, water, tides, uv } = beach;
  if (!surf && !water && !tides && !uv) return null;
  const tz = town.timezone;
  return (
    <section className={styles.beach} aria-label="Beach conditions" data-testid="beach-tiles">
      <div className={styles.beachGrid}>
        {surf ? (
          <div className={styles.beachTile} data-testid="beach-rip">
            <span className={styles.smallLabel}>Rip currents</span>
            <span className={styles.smallValue}>{surf.ripRisk} risk</span>
            <span className={styles.beachNote}>
              {[surf.surfHeight ? `Surf ${lower(surf.surfHeight)}` : null, surf.period]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        ) : null}
        {water ? (
          <div className={styles.beachTile} data-testid="beach-water">
            <span className={styles.smallLabel}>Water</span>
            <span className={styles.smallValue}>{water.fahrenheit}°</span>
            <span className={styles.beachNote}>{shortStation(water.stationName)}</span>
          </div>
        ) : null}
        {tides ? (
          <div className={styles.beachTile} data-testid="beach-tides">
            <span className={styles.smallLabel}>Tides</span>
            {tides.next.map((t) => (
              <span key={t.at} className={styles.tideLine}>
                {t.type === 'high' ? 'High' : 'Low'} {clockTime(new Date(t.at), tz)}
              </span>
            ))}
          </div>
        ) : null}
        {uv ? (
          <div className={styles.beachTile} data-testid="beach-uv">
            <span className={styles.smallLabel}>UV index</span>
            <span className={styles.smallValue}>{uv.index}</span>
            <span className={styles.beachNote}>{uvCategory(uv.index)}</span>
          </div>
        ) : null}
        {sunset ? (
          <div className={styles.beachTile} data-testid="sunset-tile">
            <span className={styles.smallLabel}>Sunset</span>
            <span className={styles.smallValue}>{clockTime(sunset, tz)}</span>
          </div>
        ) : null}
      </div>
      <p className={`meta ${styles.beachSources}`}>
        {[
          surf ? (
            <a key="nws" href={surf.url}>
              NWS {surf.office === 'MFL' ? 'Miami' : surf.office} surf forecast
            </a>
          ) : null,
          water || tides ? (
            <a
              key="noaa"
              href={`https://tidesandcurrents.noaa.gov/stationhome.html?id=${(water ?? tides)!.station}`}
            >
              NOAA Tides &amp; Currents (preliminary)
            </a>
          ) : null,
          uv ? (
            <a key="epa" href="https://www.epa.gov/sunsafety/uv-index-1">
              UV: U.S. EPA
            </a>
          ) : null,
        ]
          .filter(Boolean)
          .flatMap((node, i) => (i === 0 ? [node] : [' · ', node]))}
      </p>
    </section>
  );
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** "Lake Worth Pier, Atlantic Ocean" → "Lake Worth Pier". */
const shortStation = (name: string) => name.split(',')[0]!;
