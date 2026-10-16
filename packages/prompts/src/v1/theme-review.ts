import { cornerRadii, layoutOptions, mastheadStyles } from '@towncore/config';
import { z } from 'zod';

// Screenshot review of a generated theme (CLAUDE.md §11a, theme generation step 5). The model
// looks at the draft site on a phone and a desktop and may change only a few theme fields, from
// the option lists; code re-checks every change (contrast, neighbors, slots) and re-renders. At
// most two passes.

const e = <T extends readonly string[]>(list: T) =>
  z.enum(list as unknown as [T[number], ...T[number][]]).nullable();

export const themeReviewSchema = z.strictObject({
  verdict: z.enum(['ok', 'fix']),
  problems: z.array(z.string()),
  changes: z.strictObject({
    accent: z.string().nullable(),
    masthead: e(mastheadStyles),
    header: e(layoutOptions.header),
    grid: e(layoutOptions.grid),
    article: e(layoutOptions.article),
    footer: e(layoutOptions.footer),
    corners: e(Object.keys(cornerRadii) as Array<keyof typeof cornerRadii>),
  }),
});
export type ThemeReview = z.infer<typeof themeReviewSchema>;

export const themeReviewV1 = {
  id: 'theme-review',
  version: 'v1',
  role: 'launcher',
  effort: 'medium',
  maxOutputTokens: 2000,
  schema: themeReviewSchema,
  system: `You review the design of a new local news site from screenshots of its home, article and directory pages on a phone and a desktop. You will also get its theme and its nearby sites' themes.

Check:
- It reads as a credible, calm local paper: clear hierarchy, readable text, nothing cramped or broken.
- The brand color suits the town's identity notes and isn't garish; the wordmark is legible at phone size.
- It looks clearly different from the nearby sites.
- It avoids generic AI-site looks: cream background with a terracotta accent, soft shadows, gradient washes, all-caps labels over headings.

Things you must not judge or change: the "Sponsored" label and sand tile, bylines, source links, the weather and sign-up placement, the phone tab bar. They are fixed network-wide.

If it's fine, answer verdict "ok" with every change null. Otherwise answer "fix", list the problems in plain words, and set only the fields that fix them (accent as #RRGGBB). Leave every other field null.`,
} as const;
