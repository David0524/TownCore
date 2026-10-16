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

/** "E 10" from the hour's forecast wind ("E", "10 mph"), or null. */
export function windShort(wind: { windDirection: string; windSpeed: string } | null | undefined) {
  if (!wind) return null;
  const speed = wind.windSpeed.match(/\d+(?:\s*to\s*\d+)?/)?.[0]?.replace(/\s*to\s*/, '–');
  return speed ? `${wind.windDirection} ${speed}`.trim() : null;
}

/**
 * The Today band's two small tiles for coastal towns (D-M4b-3; canvas "Homepage"): Beach, with
 * the rip current risk from the NWS surf zone forecast, the water temperature and the next high
 * tide from NOAA; and Sunset, with the EPA UV index and the hour's forecast wind. Each part shows
 * only when its source answered. The sources are named, as each asks, on the Weather page
 * (BeachSources), not under the tiles (owner, 2026-10-16: no linked sources by the weather).
 */
export function BeachTiles({
  town,
  beach,
  sunset,
  wind,
}: {
  town: Town;
  beach: BeachConditions;
  /** Today's sunset, the second tile. */
  sunset: Date | null;
  /** This hour's forecast wind, from the weather snapshot. */
  wind?: { windDirection: string; windSpeed: string } | null;
}) {
  const { surf, water, tides, uv } = beach;
  if (!surf && !water && !tides && !uv) return null;
  const tz = town.timezone;
  const nextHigh = tides?.next.find((t) => t.type === 'high') ?? tides?.next[0];
  const risk = surf?.ripRisk.toLowerCase();
  const windNote = windShort(wind);
  return (
    <section className={styles.beach} aria-label="Beach conditions" data-testid="beach-tiles">
      <div className={styles.beachGrid}>
        <div className={`${styles.beachTile} ${styles.sand}`}>
          <span className={styles.smallLabel}>Beach</span>
          {surf ? (
            <span
              className={styles.smallValue}
              data-testid="beach-rip"
              title={surf.surfHeight ? `Surf ${lowerFirst(surf.surfHeight)}` : undefined}
            >
              <span
                className={styles.riskDot}
                data-risk={risk === 'low' ? 'low' : 'elevated'}
                aria-hidden="true"
              />
              {surf.ripRisk} rip risk
            </span>
          ) : null}
          <span className={styles.beachNote}>
            {[
              water ? (
                <span key="water" data-testid="beach-water">
                  Water {water.fahrenheit}°
                </span>
              ) : null,
              nextHigh ? (
                <span key="tide" data-testid="beach-tides">
                  {nextHigh.type === 'high' ? 'High' : 'Low'} tide{' '}
                  {clockTime(new Date(nextHigh.at), tz)}
                </span>
              ) : null,
            ]
              .filter(Boolean)
              .flatMap((node, i) => (i === 0 ? [node] : [' · ', node]))}
          </span>
        </div>
        {sunset || uv || windNote ? (
          <div className={styles.beachTile} data-testid="sunset-tile">
            <span className={styles.smallLabel}>Sunset</span>
            {sunset ? <span className={styles.smallValue}>{clockTime(sunset, tz)}</span> : null}
            <span className={styles.beachNote}>
              {[
                uv ? (
                  <span
                    key="uv"
                    data-testid="beach-uv"
                    title={`UV index ${uv.index}: ${uvCategory(uv.index).toLowerCase()}`}
                  >
                    UV {uv.index}
                  </span>
                ) : null,
                windNote ? <span key="wind">Wind {windNote}</span> : null,
              ]
                .filter(Boolean)
                .flatMap((node, i) => (i === 0 ? [node] : [' · ', node]))}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The beach tiles' sources, linked, as NOAA and the others ask; shown on the Weather page. */
export function BeachSources({ beach }: { beach: BeachConditions }) {
  const { surf, water, tides, uv } = beach;
  if (!surf && !water && !tides && !uv) return null;
  return (
    <p className="meta" data-testid="beach-sources">
      Beach conditions:{' '}
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
  );
}
