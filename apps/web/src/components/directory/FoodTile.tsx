import type { FoodIcon, FoodLook } from './food';
import styles from './food.module.css';

// Our own line drawings (Rule 9: no images from other sites), one per flavor of place, drawn in
// the flavor's ink on its tint. 48×48, 2px strokes, round joins, like the rest of our icons.
const ICONS: Record<FoodIcon, React.ReactNode> = {
  pizza: (
    <>
      <path d="M8 12c10-5 22-5 32 0L24 42Z" />
      <path d="M10.5 17c8.5-3.5 18.5-3.5 27 0" />
      <circle cx="20" cy="22" r="2" />
      <circle cx="28" cy="24" r="2" />
      <circle cx="23" cy="31" r="2" />
    </>
  ),
  taco: (
    <>
      <path d="M6 34a18 18 0 0 1 36 0Z" />
      <path d="M11 26c2-2 4 1 6-1s4 1 6-1 4 1 6-1 4 1 6-1 4 1 3 2" />
      <path d="M14 34a10 10 0 0 1 20 0" />
    </>
  ),
  bowl: (
    <>
      <path d="M7 24h34a17 13 0 0 1-34 0Z" />
      <path d="M17 39h14" />
      <path d="M26 20 38 6M30 20 42 9" />
      <path d="M15 20c0-3 3-3 3-6M21 20c0-3 3-3 3-6" />
    </>
  ),
  fish: (
    <>
      <path d="M6 24c6-9 20-12 30-1 0 0-2 1-2 1 0 0 2 0 2 1-10 11-24 8-30-1Z" />
      <path d="M36 23l7-6v14l-7-6" />
      <circle cx="14" cy="22" r="1.6" />
      <path d="M22 18c2 4 2 8 0 12" />
    </>
  ),
  burger: (
    <>
      <path d="M8 21a16 11 0 0 1 32 0Z" />
      <path d="M7 26h34" />
      <path d="M8 31c3 2 5-2 8 0s5-2 8 0 5-2 8 0 5-2 8 0" />
      <path d="M9 35h30a4 4 0 0 1-4 5H13a4 4 0 0 1-4-5Z" />
      <path d="M18 15h.01M24 13h.01M30 15h.01" />
    </>
  ),
  coffee: (
    <>
      <path d="M9 18h24v10a10 10 0 0 1-10 10h-4A10 10 0 0 1 9 28Z" />
      <path d="M33 21h3a5 5 0 0 1 0 10h-4" />
      <path d="M6 42h30" />
      <path d="M16 6c-2 3 2 5 0 8M23 6c-2 3 2 5 0 8" />
    </>
  ),
  sweets: (
    <>
      <path d="M12 25h24l-3 17H15Z" />
      <path d="M19 25l1 17M29 25l-1 17" />
      <path d="M11 25c-2-6 4-9 7-8 1-5 11-5 12 0 3-1 9 2 7 8" />
      <circle cx="24" cy="9" r="2.5" />
    </>
  ),
  leaf: (
    <>
      <path d="M10 38C8 20 22 8 40 8c0 18-12 32-30 30Z" />
      <path d="M10 38 30 18" />
      <path d="M18 30h8M22 26v-7" />
    </>
  ),
  cloche: (
    <>
      <path d="M8 34a16 16 0 0 1 32 0Z" />
      <path d="M5 38h38" />
      <path d="M24 18v-4M21 14h6" />
    </>
  ),
  bag: (
    <>
      <path d="M11 16h26l-2 26H13Z" />
      <path d="M18 20v-6a6 6 0 0 1 12 0v6" />
      <path d="M17 30h14" />
    </>
  ),
  plate: (
    <>
      <circle cx="24" cy="25" r="11" />
      <circle cx="24" cy="25" r="6" />
      <path d="M6 8v10a3 3 0 0 0 3 3v19M6 8v8M10 8v8" />
      <path d="M42 8c-3 2-4 6-4 11h4v21" />
    </>
  ),
};

/** The colored tile with the drawn icon; aria-hidden, since the card's words carry the meaning. */
export function FoodTile({ look, children }: { look: FoodLook; children?: React.ReactNode }) {
  return (
    <span
      className={styles.tile}
      style={
        {
          '--tile': `var(--food-${look.color})`,
          '--tile-ink': `var(--food-${look.color}-ink)`,
        } as React.CSSProperties
      }
      data-food={look.icon}
    >
      <svg viewBox="0 0 48 48" aria-hidden="true" className={styles.icon}>
        {ICONS[look.icon]}
      </svg>
      {children}
    </span>
  );
}

/** The same drawing in a small round badge, beside a place's name in lists. */
export function FoodDot({ look }: { look: FoodLook }) {
  return (
    <span
      className={styles.dot}
      style={
        {
          '--tile': `var(--food-${look.color})`,
          '--tile-ink': `var(--food-${look.color}-ink)`,
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48" className={styles.icon}>
        {ICONS[look.icon]}
      </svg>
    </span>
  );
}
