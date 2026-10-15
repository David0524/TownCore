import type { Town } from '@towncore/db';
import type { TownWeather } from '@/modules/data';
import { untilLabel } from './format';
import styles from './weather.module.css';

const severityOrder = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];

/** The amber bar: only while an NWS alert is active (amber means a real warning, nothing else). */
export function AlertBar({ town, weather }: { town: Town; weather: TownWeather | null }) {
  if (weather?.kind !== 'snapshot' || weather.snapshot.alerts.length === 0) return null;
  const [alert] = [...weather.snapshot.alerts].sort(
    (a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity),
  );
  const more = weather.snapshot.alerts.length - 1;
  return (
    <a className={styles.alert} href={alert!.url} data-testid="alert-bar">
      <span className={styles.alertInner}>
        <strong>{alert!.event}</strong>
        <span>
          {alert!.until ? untilLabel(alert!.until, town.timezone) : 'in effect'}
          {more > 0 ? ` · ${more} more ${more === 1 ? 'alert' : 'alerts'}` : ''}
        </span>
        <span className={styles.alertSource}>National Weather Service →</span>
      </span>
    </a>
  );
}
