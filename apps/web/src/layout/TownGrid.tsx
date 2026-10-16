import type { ReactNode } from 'react';
import type { Theme } from '@towncore/config';
import type { Town } from '@towncore/db';
import { Slot } from '@/slots/Slot';
import { Grid } from './Grid';

/**
 * The page grid for a town page. With a rail, rail.box sits in it; on single-column pages the
 * caller places rail.box inline (CLAUDE.md §11b: "stacks inline on mobile").
 */
export function TownGrid({
  town,
  kind,
  measure = 'normal',
  top,
  railModules,
  railHouseOffOnPhones,
  children,
}: {
  town: Town;
  kind: Theme['layout']['grid'];
  measure?: 'normal' | 'wide';
  /** Full-width area above the columns. */
  top?: ReactNode;
  /** Modules shown in the rail above rail.box (homepage). */
  railModules?: ReactNode;
  /** Leave an unsold rail.box out on phones, where the rail stacks under a short page. */
  railHouseOffOnPhones?: boolean;
  children: ReactNode;
}) {
  return (
    <Grid
      kind={kind}
      measure={measure}
      top={top}
      rail={
        kind === 'main-right-rail' ? (
          <>
            {railModules}
            <Slot town={town} name="rail.box" houseOffOnPhones={railHouseOffOnPhones} />
          </>
        ) : null
      }
    >
      {children}
    </Grid>
  );
}
