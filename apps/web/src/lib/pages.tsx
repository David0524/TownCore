import type { ReactNode } from 'react';
import { TownGrid } from '@/layout/TownGrid';
import { Slot } from '@/slots/Slot';
import { themeFor } from '@/lib/theme';
import type { Town } from '@towncore/db';

/** Standard page frame: the town's grid, with rail.box inline at the end on single-column. */
export function StandardPage({ town, children }: { town: Town; children: ReactNode }) {
  const theme = themeFor(town);
  return (
    <TownGrid town={town} kind={theme.layout.grid}>
      {children}
      {theme.layout.grid === 'single-column' ? <Slot town={town} name="rail.box" /> : null}
    </TownGrid>
  );
}
