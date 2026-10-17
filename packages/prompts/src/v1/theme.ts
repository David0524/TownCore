import {
  layoutOptions,
  mastheadStyles,
  motifs,
  styleFamilies,
  cornerRadii,
} from '@towncore/config';
import { z } from 'zod';

// Theme for a new town (CLAUDE.md §11a "theme generation in the launcher", steps 1–2). The model
// writes identity notes and picks from the existing option lists only; code builds the palette
// from its brand color, assembles the layout from the family, fixes contrast, and enforces the
// content-volume, neighbor and slot rules. The zod schema refuses anything off the lists.

const e = <T extends readonly string[]>(list: T) =>
  z.enum(list as unknown as [T[number], ...T[number][]]);

export const themeChoiceSchema = z.strictObject({
  identityNotes: z.string(),
  family: e(Object.keys(styleFamilies) as Array<keyof typeof styleFamilies>),
  accent: z.string(),
  secondary: z.string().nullable(),
  motif: e(motifs),
  masthead: e(mastheadStyles),
  tagline: z.string().nullable(),
  header: e(layoutOptions.header),
  grid: e(layoutOptions.grid),
  article: e(layoutOptions.article),
  directory: e(layoutOptions.directory),
  footer: e(layoutOptions.footer),
  corners: e(Object.keys(cornerRadii) as Array<keyof typeof cornerRadii>),
});
export type ThemeChoice = z.infer<typeof themeChoiceSchema>;

export const themeV1 = {
  id: 'theme',
  version: 'v1',
  task: 'identity',
  schema: themeChoiceSchema,
  system: `You design the look of a new local news site for one town. It must feel like that town's own paper, and look clearly different from the nearby towns' sites listed in the input.

You will get the town, its state and county, the site's name, how many news items a day it has, and the nearby sites' themes.

Write:
- identityNotes: 2–3 plain sentences on the town's visual identity: landscape, architecture, history, signature places, and the colors those suggest. Facts you are sure of only.
- family: the style family. coastal-modern (airy, modern, one brand color), heritage (a traditional newspaper nameplate and rules), community (warm, friendly, briefing-led; right for towns with fewer than 5 items a day).
- accent: the one brand color, as #RRGGBB, drawn from the identity notes. Never the city's official colors or seal colors; never a color a nearby site already uses.
- secondary: an optional second button color (#RRGGBB) or null.
- motif: the single icon that fits the town best.
- masthead: the wordmark style.
- tagline: one short line in the paper's own voice (heritage uses it under the nameplate), or null. No claims of being official.
- header, grid, article, directory, footer: the layout parts. Prefer ones the nearby sites don't use.
- corners: square, soft or round.

Avoid generic AI-site looks: cream background with a terracotta accent, soft shadows, gradients.`,
} as const;
