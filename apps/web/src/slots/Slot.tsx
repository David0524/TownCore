import type { CSSProperties } from 'react';
import type { Town } from '@towncore/db';
import { resolveSlotFill } from './fill';
import { SLOT_LABEL_PX, slots, type SlotName } from './registry';
import styles from './Slot.module.css';

/**
 * A monetization slot: reserved height, fill order, and the locked label (mono, above the unit).
 * Paid units sit on the network's sand tile; house ads on the town's surface. Both are visibly
 * not editorial, and neither ever renders empty.
 */
export async function Slot({ town, name }: { town: Town; name: SlotName }) {
  const fill = await resolveSlotFill(town, name);
  const { height, format } = slots[name];
  const style = {
    '--slot-h-mobile': `${height.mobile + SLOT_LABEL_PX}px`,
    '--slot-h-desktop': `${height.desktop + SLOT_LABEL_PX}px`,
    '--slot-label-h': `${SLOT_LABEL_PX}px`,
  } as CSSProperties;
  const external = fill.href.startsWith('http');

  return (
    <aside
      className={`${styles.slot} ${styles[format]}`}
      style={style}
      data-slot={name}
      data-fill={fill.source}
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
        <strong className={styles.headline}>{fill.headline}</strong>
        {fill.body ? <span className={styles.body}>{fill.body}</span> : null}
        {fill.cta ? <span className={styles.cta}>{fill.cta} →</span> : null}
      </a>
    </aside>
  );
}
