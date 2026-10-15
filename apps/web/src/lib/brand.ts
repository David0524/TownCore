import { brandColors } from '@towncore/config';

// TownCore network brand (CLAUDE.md §11): only for locked network elements (the footer badge,
// the /network panel, network-level pages), never for a town's look. Prefixed so town themes
// can't collide with or override them.
export const networkCssVariables = `:root{${Object.entries(brandColors)
  .map(([name, hex]) => `--net-${name}:${hex};`)
  .join('')}--net-radius-pill:999px;}`;
