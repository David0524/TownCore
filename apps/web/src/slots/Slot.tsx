import type { CSSProperties } from 'react';
import type { Town } from '@towncore/db';
import { resolveSlotFill } from './fill';
import { slots, type SlotName } from './registry';
import styles from './Slot.module.css';

/** A monetization slot: reserved height, fill order, and the locked label style. */
export async function Slot({ town, name }: { town: Town; name: SlotName }) {
  const fill = await resolveSlotFill(town, name);
  const { height } = slots[name];
  const style = {
    '--slot-h-mobile': `${height.mobile}px`,
    '--slot-h-desktop': `${height.desktop}px`,
  } as CSSProperties;
  const external = fill.href.startsWith('http');

  return (
    <aside
      className={styles.slot}
      style={style}
      data-slot={name}
      data-fill={fill.source}
      aria-label={fill.source === 'campaign' ? 'Sponsored content' : 'Message from this site'}
    >
      <span className={styles.label} data-testid="slot-label">
        {fill.label}
      </span>
      <a
        className={styles.card}
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
