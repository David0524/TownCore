import type { ReactNode } from 'react';
import { cache } from 'react';
import type { DirectoryCategory } from '@towncore/config';
import type { Town } from '@towncore/db';
import { StandardPage } from '@/lib/pages';
import { themeFor } from '@/lib/theme';
import { NewsletterCta } from '@/modules/news';
import { resolveSlotFill } from '@/slots/fill';
import { SlotUnit } from '@/slots/Slot';

const EXCLUSIVE = 'directory.category.exclusive';

// Once per request, whichever place renders it.
const exclusiveFill = cache((town: Town, category: DirectoryCategory) =>
  resolveSlotFill(town, EXCLUSIVE, new Date(), { category }),
);

/**
 * `directory.category.exclusive` (CLAUDE.md §11b). A sold category sponsorship sits in the
 * category header, in full and labeled; unsold, its house ad waits in the desktop rail instead of
 * above the listings, and is left out on phones (owner, 2026-10-16 and 2026-10-17).
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
 * or as a bottom bar"): listings in the main column, and a rail on every town, whatever its
 * grid, holding the morning-email signup, the rail box and the category's unsold header slot.
 * On phones the rail stacks after the listings, so the signup is a plain block at the bottom of
 * the page, never a bar over it (§11b: no sticky ads). The rail is a fixed 300px so the
 * listings fill three columns on desktop.
 */
export function DirectoryFrame({
  town,
  category,
  shortOnPhones,
  children,
}: {
  town: Town;
  /** The kind the page lists. */
  category?: DirectoryCategory | null | undefined;
  shortOnPhones?: boolean | undefined;
  children: ReactNode;
}) {
  const theme = themeFor(town);
  return (
    <StandardPage
      town={town}
      shortOnPhones={shortOnPhones}
      rail={[
        <div key="newsletter" data-in-rail="" data-testid="directory-newsletter">
          <NewsletterCta town={town} theme={theme} modules={[]} placement="directory" />
        </div>,
        category ? (
          <CategoryExclusive key="exclusive" town={town} category={category} where="rail" />
        ) : null,
      ]}
    >
      {children}
    </StandardPage>
  );
}
