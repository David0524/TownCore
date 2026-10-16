import type { CSSProperties } from 'react';
import type { Town } from '@towncore/db';
import { resolveSlotFill, type SlotContext, type SlotFill } from './fill';
import { SLOT_LABEL_PX, slots, type SlotName } from './registry';
import styles from './Slot.module.css';

/**
 * A monetization slot: reserved height, fill order, and the locked label (mono, above the unit).
 * Paid units sit on the network's sand tile; the site's own house ads are designed promotions
 * in the town's brand. Both are visibly not editorial, and neither ever renders empty.
 */
export async function Slot({
  town,
  name,
  context,
  houseOffOnPhones,
}: {
  town: Town;
  name: SlotName;
  context?: SlotContext;
  /** Leave a house-ad fill out on phones (a short page over the ad-density limit). */
  houseOffOnPhones?: boolean;
}) {
  return (
    <SlotUnit
      name={name}
      fill={await resolveSlotFill(town, name, new Date(), context)}
      houseOffOnPhones={houseOffOnPhones}
    />
  );
}

/** One filled unit in the locked slot style (also used for each of several sponsor cards). */
export function SlotUnit({
  name,
  fill,
  houseOffOnPhones,
}: {
  name: SlotName;
  fill: SlotFill;
  houseOffOnPhones?: boolean;
}) {
  const { height, format } = slots[name];
  const style = {
    '--slot-h-mobile': `${height.mobile + SLOT_LABEL_PX}px`,
    '--slot-h-desktop': `${height.desktop + SLOT_LABEL_PX}px`,
    '--slot-label-h': `${SLOT_LABEL_PX}px`,
  } as CSSProperties;
  const external = fill.href.startsWith('http');

  return (
    <aside
      // A paid unit always shows; only our own house ad may step aside on a short phone page,
      // in CSS from the first paint, so nothing shifts (§11b ad density).
      className={`${styles.slot} ${styles[format]}${houseOffOnPhones && fill.source === 'house' ? ` ${styles.phoneOff}` : ''}`}
      style={style}
      data-slot={name}
      data-fill={fill.source}
      data-campaign={fill.campaignId}
      data-format={format}
      aria-label={fill.source === 'campaign' ? 'Sponsored content' : 'Message from this site'}
    >
      <span className={styles.label} data-testid="slot-label">
        {fill.label}
      </span>
      <a
        className={`${styles.unit} ${fill.source === 'campaign' ? styles.paid : styles.house}`}
        href={fill.href}
        {...(external ? { rel: 'sponsored noopener', target: '_blank' } : {})}
      >
        <span className={styles.text}>
          <strong className={styles.headline}>{fill.headline}</strong>
          {fill.body ? <span className={styles.body}>{fill.body}</span> : null}
        </span>
        {fill.offers?.length ? (
          <span className={styles.offers} data-testid="slot-offers">
            {fill.offers.map((o) => (
              <span key={o.rank} className={styles.offer}>
                <span className={styles.rank}>{o.rank}</span>
                <span className={styles.price}>{o.price}</span>
              </span>
            ))}
          </span>
        ) : null}
        {fill.cta ? (
          <span className={styles.cta}>
            {fill.cta} <span aria-hidden="true">›</span>
          </span>
        ) : null}
      </a>
    </aside>
  );
}
