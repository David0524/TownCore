// Sunrise and sunset from latitude and longitude (NOAA's solar equations, accurate to about a
// minute at our latitudes). Computed, not fetched: no outside data source is involved.

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Sunrise and sunset (UTC) on the given UTC calendar date, or null at polar day or night. */
export function sunTimes(
  date: Date,
  lat: number,
  lon: number,
): { sunrise: Date; sunset: Date } | null {
  const day0 = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const t = (offsetMinutes: number) => {
    // Julian century at local solar noon, refined below.
    const jd = (day0 + offsetMinutes * 60_000) / 86_400_000 + 2440587.5;
    return (jd - 2451545) / 36525;
  };
  const solar = (T: number) => {
    const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const C =
      Math.sin(rad(M)) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
      Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * T) +
      Math.sin(rad(3 * M)) * 0.000289;
    const trueLong = L0 + C;
    const omega = 125.04 - 1934.136 * T;
    const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * Math.cos(rad(omega));
    const decl = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))));
    const y = Math.tan(rad(eps / 2)) ** 2;
    const eqTime =
      4 *
      deg(
        y * Math.sin(2 * rad(L0)) -
          2 * e * Math.sin(rad(M)) +
          4 * e * y * Math.sin(rad(M)) * Math.cos(2 * rad(L0)) -
          0.5 * y * y * Math.sin(4 * rad(L0)) -
          1.25 * e * e * Math.sin(2 * rad(M)),
      );
    return { decl, eqTime };
  };
  const event = (rising: boolean): Date | null => {
    // Two passes: estimate at solar noon, then refine at the event time.
    let minutes = 720 - 4 * lon;
    for (let pass = 0; pass < 2; pass++) {
      const { decl, eqTime } = solar(t(minutes));
      const cosH =
        Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(rad(decl))) -
        Math.tan(rad(lat)) * Math.tan(rad(decl));
      if (cosH < -1 || cosH > 1) return null;
      const ha = deg(Math.acos(cosH)) * (rising ? 1 : -1);
      minutes = 720 - 4 * (lon + ha) - eqTime;
    }
    return new Date(day0 + minutes * 60_000);
  };
  const sunrise = event(true);
  const sunset = event(false);
  return sunrise && sunset ? { sunrise, sunset } : null;
}

/** Today's sunset for a town: its local calendar date, its coordinates. */
export function townSunset(now: Date, timeZone: string, lat: number, lon: number): Date | null {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(now);
  const times = sunTimes(new Date(`${local}T12:00:00Z`), lat, lon);
  if (!times) return null;
  // Sunset at western longitudes can fall after midnight UTC; it's still "today" locally.
  return times.sunset.getTime() < times.sunrise.getTime()
    ? new Date(times.sunset.getTime() + 86_400_000)
    : times.sunset;
}
