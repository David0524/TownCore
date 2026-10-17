import type { ReactNode } from 'react';
import { TownGrid } from '@/layout/TownGrid';
import { Slot } from '@/slots/Slot';
import { themeFor } from '@/lib/theme';
import type { Town } from '@towncore/db';

/**
 * Standard page frame: the town's grid, with rail.box inline at the end on single-column.
 * `shortOnPhones`: the page is short, so an unsold rail.box (a house ad) is left out on phones.
 * `rail`: the page brings rail modules (the directory), so it has a fixed-width rail on every
 * town, whatever the town's grid; rail.box goes after the first module.
 */
export function StandardPage({
  town,
  shortOnPhones,
  rail,
  children,
}: {
  town: Town;
  shortOnPhones?: boolean | undefined;
  rail?: ReactNode[];
  children: ReactNode;
}) {
  const theme = themeFor(town);
  const kind = rail ? 'main-right-rail' : theme.layout.grid;
  return (
    <TownGrid
      town={town}
      kind={kind}
      railModules={rail}
      narrowRail={Boolean(rail)}
      railHouseOffOnPhones={shortOnPhones}
    >
      {children}
      {kind === 'single-column' ? (
        <Slot town={town} name="rail.box" houseOffOnPhones={shortOnPhones} />
      ) : null}
    </TownGrid>
  );
}
