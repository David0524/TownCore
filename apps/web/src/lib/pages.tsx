import type { ReactNode } from 'react';
import { TownGrid } from '@/layout/TownGrid';
import { Slot } from '@/slots/Slot';
import { themeFor } from '@/lib/theme';
import type { Town } from '@towncore/db';

/**
 * Standard page frame: the town's grid, with rail.box inline at the end on single-column.
 * `shortOnPhones`: the page is short, so an unsold rail.box (a house ad) is left out on phones.
 */
export function StandardPage({
  town,
  shortOnPhones,
  children,
}: {
  town: Town;
  shortOnPhones?: boolean;
  children: ReactNode;
}) {
  const theme = themeFor(town);
  return (
    <TownGrid town={town} kind={theme.layout.grid} railHouseOffOnPhones={shortOnPhones}>
      {children}
      {theme.layout.grid === 'single-column' ? (
        <Slot town={town} name="rail.box" houseOffOnPhones={shortOnPhones} />
      ) : null}
    </TownGrid>
  );
}
