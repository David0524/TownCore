import type { WeatherAlert } from '@towncore/config';
import type { Town } from '@towncore/db';
import { WarningIcon } from '@/components/phone/icons';
import { untilLabel } from './format';
import styles from './weather.module.css';

const severityOrder = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];

/**
 * Every active NWS alert for the town's zone, most severe first: the event, how long it lasts and
 * NWS's headline, linked to the alert. Alert amber, as on the bar (§11a: amber means a real
 * warning; one color for every severity). On phones, a grouped list with an amber glyph.
 */
export function AlertList({ town, alerts }: { town: Town; alerts: WeatherAlert[] }) {
  if (alerts.length === 0) return null;
  const sorted = [...alerts].sort(
    (a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity),
  );
  return (
    <section aria-labelledby="alerts-h" className={styles.alertSection}>
      <h2 id="alerts-h" className="sr-only">
        Weather alerts
      </h2>
      <ul className={styles.alertList} data-testid="alert-list">
        {sorted.map((a) => (
          <li key={a.id}>
            <span className={`${styles.alertIcon} phone-only`}>
              <WarningIcon />
            </span>
            <span className={styles.alertBody}>
              <a href={a.url} rel="noopener" className={styles.alertEvent}>
                {a.event}
              </a>
              <span className={styles.alertUntil}>
                {a.until ? untilLabel(a.until, town.timezone) : 'in effect'}
              </span>
              {a.headline && a.headline !== a.event ? (
                <span className={styles.alertHeadline}>{a.headline}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
