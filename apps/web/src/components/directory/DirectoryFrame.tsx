import type { ReactNode } from 'react';
import { cache } from 'react';
import type { DirectoryCategory } from '@towncore/config';
import type { Town } from '@towncore/db';
import { TownGrid } from '@/layout/TownGrid';
import { themeFor } from '@/lib/theme';
import { NewsletterCta } from '@/modules/news';
import { resolveSlotFill } from '@/slots/fill';
import { Slot, SlotUnit } from '@/slots/Slot';
import styles from './DirectoryFrame.module.css';

const EXCLUSIVE = 'directory.category.exclusive';

// Once per request, whichever place renders it.
const exclusiveFill = cache((town: Town, category: DirectoryCategory) =>
  resolveSlotFill(town, EXCLUSIVE, new Date(), { category }),
);

/**
 * `directory.category.exclusive` (CLAUDE.md §11b). A sold category sponsorship sits in the
 * category header, in full and labeled; unsold, its house ad waits below the listings, and is
 * left out on phones (owner, 2026-10-16 and 2026-10-17).
 */
export async function CategoryExclusive({
  town,
  category,
  where,
}: {
  town: Town;
  category: DirectoryCategory;
  where: 'header' | 'rail';
}) {
  const fill = await exclusiveFill(town, category);
  if ((fill.source === 'campaign') !== (where === 'header')) return null;
  return <SlotUnit name={EXCLUSIVE} fill={fill} houseOffOnPhones />;
}

/**
 * Every directory page's frame (owner, 2026-10-17: "Move the newsletter to either the right side
 * or as a bottom bar"; "I meant to utilize the right side of the screen that is sitting empty").
 * The whole page width, on every town: the heading and kinds bar with the morning-email signup
 * beside them, then the listings across the full width, three cards a row at full size, then
 * the category's unsold header slot and rail.box below them (§11b: rail.box stacks inline where
 * there is no rail). On phones the signup moves after the listings, a plain block, never a bar
 * over the page (§11b: no sticky ads).
 */
export function DirectoryFrame({
  town,
  category,
  shortOnPhones,
  head,
  children,
}: {
  town: Town;
  /** The kind the page lists. */
  category?: DirectoryCategory | null | undefined;
  shortOnPhones?: boolean | undefined;
  /** The page heading and kinds bar, beside the signup on desktop. */
  head: ReactNode;
  children: ReactNode;
}) {
  const theme = themeFor(town);
  return (
    <TownGrid town={town} kind="single-column" measure="full">
      <div className={styles.frame}>
        <div className={styles.head}>{head}</div>
        <aside
          className={styles.signup}
          data-in-rail=""
          aria-label="Morning email"
          data-testid="directory-newsletter"
        >
          <NewsletterCta town={town} theme={theme} modules={[]} placement="directory" />
        </aside>
        <div className={styles.body}>{children}</div>
        <div className={styles.after}>
          {category ? <CategoryExclusive town={town} category={category} where="rail" /> : null}
          <Slot town={town} name="rail.box" houseOffOnPhones={shortOnPhones} />
        </div>
      </div>
    </TownGrid>
  );
}
