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
  bottom,
  railModules,
  railHouseOffOnPhones,
  narrowRail,
  children,
}: {
  town: Town;
  kind: Theme['layout']['grid'];
  measure?: 'normal' | 'wide' | 'full';
  /** Full-width area above the columns. */
  top?: ReactNode;
  /** Full-width area below the columns. */
  bottom?: ReactNode;
  /** Modules shown in the rail (homepage). rail.box goes after the first (canvas "Homepage"). */
  railModules?: ReactNode[] | ReactNode;
  /** Leave an unsold rail.box out on phones, where the rail stacks under a short page. */
  railHouseOffOnPhones?: boolean | undefined;
  /** A fixed 300px rail on every family, so the main column is as wide as it can be. */
  narrowRail?: boolean;
  children: ReactNode;
}) {
  return (
    <Grid
      kind={kind}
      narrowRail={narrowRail}
      measure={measure}
      top={top}
      bottom={bottom}
      rail={
        kind === 'main-right-rail' ? (
          <>
            {Array.isArray(railModules) ? railModules[0] : railModules}
            <Slot town={town} name="rail.box" houseOffOnPhones={railHouseOffOnPhones} />
            {Array.isArray(railModules) ? railModules.slice(1) : null}
          </>
        ) : null
      }
    >
      {children}
    </Grid>
  );
}
