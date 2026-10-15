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
  children,
}: {
  town: Town;
  kind: Theme['layout']['grid'];
  measure?: 'normal' | 'wide';
  children: ReactNode;
}) {
  return (
    <Grid
      kind={kind}
      measure={measure}
      rail={kind === 'main-right-rail' ? <Slot town={town} name="rail.box" /> : null}
    >
      {children}
    </Grid>
  );
}
