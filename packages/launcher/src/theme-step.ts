import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkThemeForTown,
  defaultTheme,
  layoutOptions,
  mastheadStyles,
  motifs,
  parseTheme,
  parseTownConfig,
  styleFamilies,
  themeSchema,
  type StyleFamily,
  type Theme,
  type TownConfig,
} from '@towncore/config';
import { and, articles, desc, eq, isNotNull, ne, syncTowns, towns, type Db } from '@towncore/db';
import { callModel, type Llm } from '@towncore/pipeline';
import { themeReviewV1, themeV1, type ThemeChoice, type ThemeReview } from '@towncore/prompts';
import { capturePages, captureIdentity, type Shot, type ShotTarget } from './screenshots';
import type { Place } from './census';
import { adjustContrast, colorDistance, hexToOklch, oklchToHex, paletteFromAccent } from './color';
import { logoPromptStep, type ArtDetail } from './identity-step';
import type { NamesDetail } from './names-step';
import { NEIGHBOR_MILES } from './names';
import { milesBetween } from './rank';
import type { ReadinessDetail } from './readiness';
import type { ResolvedTown } from './resolve';
import { launchLlmTown } from './sources-step';

// Launch step 6b (CLAUDE.md §11a "theme generation in the launcher"; docs/plans/M7.md §5). The
// model (when configured) writes identity notes and picks from the option lists; code builds the
// theme from the family's preset, fixes contrast, and enforces the content-volume rule, the slot
// contract and the neighbor rule (§11a-2). Without a model a deterministic theme is made from the
// town's name, and the report says identity research is still to do.

/** Each family's structural defaults: the three designed towns (Boca, Harbor Point, Pine Hollow). */
export const familyPresets: Record<
  StyleFamily,
  Omit<Theme, 'palette' | 'identityNotes' | 'motif'>
> = {
  'coastal-modern': {
    family: 'coastal-modern',
    type: 'outfit-geist',
    masthead: 'centered-serif',
    layout: {
      header: 'slim-left',
      nav: 'category-tabs',
      grid: 'main-right-rail',
      homeTop: ['good-morning', 'lead-story', 'today-bento'],
      home: [
        'category-buttons',
        'newsletter-cta',
        'events',
        'latest-list',
        'directory-featured',
        'new-businesses',
        'real-estate',
      ],
      homeRail: ['coming-up', 'quick-poll', 'find-a-pro', 'essentials'],
      homeBottom: ['photo-of-the-week', 'new-now-open'],
      article: 'classic-rail',
      directory: 'list-map',
      footer: 'three-column',
    },
    corners: 'soft',
  },
  heritage: {
    family: 'heritage',
    type: 'librecaslondisplay-publicsans',
    masthead: 'ruled-nameplate',
    layout: {
      header: 'nameplate-double-rule',
      nav: 'text-nav',
      grid: 'single-column',
      homeTop: ['today-bento', 'newsletter-cta', 'coming-up', 'lead-story', 'briefs'],
      home: [
        'beat-sections',
        'essentials',
        'directory-featured',
        'find-a-pro',
        'new-now-open',
        'quick-poll',
        'documents-posted',
      ],
      article: 'wide-reading',
      directory: 'category-grid',
      footer: 'minimal',
    },
    corners: 'square',
  },
  community: {
    family: 'community',
    type: 'bricolage-figtree',
    masthead: 'left-motif',
    layout: {
      header: 'tinted-bar',
      nav: 'beat-tabs',
      grid: 'main-right-rail',
      homeTop: ['category-buttons', 'briefing-column', 'newsletter-cta', 'today-bento'],
      home: ['beat-sections', 'essentials', 'events', 'directory-featured', 'documents-posted'],
      homeRail: ['coming-up', 'quick-poll'],
      article: 'classic-rail',
      directory: 'search-first',
      footer: 'community',
    },
    corners: 'round',
  },
};

/** Fewer real items a day than this means a briefing-led community front (§11a-2). */
export const LOW_VOLUME_ITEMS = 5;

export type Neighbor = { name: string; siteName: string; miles: number; theme: Theme };

/** Live and draft towns within 50 miles, nearest first, with their themes. */
export async function nearbyThemes(
  db: Db,
  places: (state: string) => Promise<Place[]>,
  town: Pick<ResolvedTown, 'censusId' | 'lat' | 'lon'>,
  fallback: Theme,
): Promise<Neighbor[]> {
  const ours = await db
    .select({
      name: towns.name,
      siteName: towns.siteName,
      state: towns.state,
      censusId: towns.censusId,
      theme: towns.theme,
    })
    .from(towns)
    .where(and(isNotNull(towns.censusId), ne(towns.status, 'paused')));
  const byState = new Map<string, Place[]>();
  const out: Neighbor[] = [];
  for (const t of ours) {
    if (t.censusId === town.censusId) continue;
    if (!byState.has(t.state)) byState.set(t.state, await places(t.state));
    const p = byState.get(t.state)!.find((x) => x.geoid === t.censusId);
    if (!p) continue;
    const miles = Math.round(milesBetween(p, town));
    if (miles <= NEIGHBOR_MILES)
      out.push({
        name: t.name,
        siteName: t.siteName,
        miles,
        theme: (t.theme as Theme | null) ?? fallback,
      });
  }
  return out.sort((a, b) => a.miles - b.miles);
}

const firstThree = (t: Theme) =>
  [...(t.layout.homeTop ?? []), ...t.layout.home]
    .filter((m) => m !== 'good-morning')
    .slice(0, 3)
    .join(',');

/** Same family and a palette that reads the same (accent within ΔE 0.1). */
const sharesFamilyAndPalette = (a: Theme, b: Theme) =>
  a.family === b.family && colorDistance(a.palette.accent, b.palette.accent) < 0.1;

/** The neighbor rule (§11a-2): problems against towns within 50 miles. */
export function neighborProblems(theme: Theme, neighbors: Neighbor[]): string[] {
  const problems: string[] = [];
  for (const n of neighbors) {
    if (sharesFamilyAndPalette(theme, n.theme))
      problems.push(`shares family and palette with ${n.siteName} (${n.miles} miles)`);
    const shared = [
      theme.layout.header === n.theme.layout.header ? 'header' : null,
      theme.layout.grid === n.theme.layout.grid ? 'grid' : null,
      theme.layout.article === n.theme.layout.article ? 'article template' : null,
      firstThree(theme) === firstThree(n.theme) ? 'first three modules' : null,
    ].filter(Boolean);
    if (shared.length > 2)
      problems.push(`shares ${shared.join(', ')} with ${n.siteName} (${n.miles} miles)`);
  }
  return problems;
}

/**
 * The slot contract for the homepage: the newsletter sign-up among the first two modules on
 * phones. With a full-width band (`homeTop`) the page itself places a phone copy after the first
 * band module when the layout doesn't (apps/web bandNeedsCta); without one, the order must do it.
 */
export function slotProblems(theme: Theme): string[] {
  if ((theme.layout.homeTop ?? []).length > 0) return [];
  const order = theme.layout.home.filter((m) => m !== 'good-morning' && m !== 'category-buttons');
  return order.slice(0, 2).includes('newsletter-cta')
    ? []
    : ['the newsletter sign-up must be among the first two modules on phones'];
}

/** A theme from the model's choices (or the fallback's) on top of the family preset. */
export function buildTheme(
  choice: ThemeChoice,
  opts: { itemsPerDay: number },
): { theme: Theme; notes: string[] } {
  const notes: string[] = [];
  let family = choice.family;
  if (opts.itemsPerDay < LOW_VOLUME_ITEMS && family !== 'community') {
    notes.push(
      `${opts.itemsPerDay} items a day is under ${LOW_VOLUME_ITEMS}: the briefing-led community family is used (§11a-2).`,
    );
    family = 'community';
  }
  const preset = familyPresets[family];
  const { palette, changed } = adjustContrast(paletteFromAccent(choice.accent, choice.secondary));
  if (changed.length)
    notes.push(`Contrast: ${changed.join(', ')} moved in lightness to pass WCAG AA.`);
  const layout = { ...preset.layout };
  // Parts the model may vary; the family's own header stays unless the model picked another.
  layout.header = choice.header;
  layout.article = choice.article;
  layout.directory = choice.directory;
  layout.footer = choice.footer;
  if (choice.grid === 'single-column' && layout.homeRail) {
    layout.home = [...layout.home, ...layout.homeRail];
    delete layout.homeRail;
  } else if (choice.grid === 'main-right-rail' && !layout.homeRail) {
    layout.homeRail = ['coming-up'];
    layout.home = layout.home.filter((m) => m !== 'coming-up');
    layout.homeTop = (layout.homeTop ?? []).filter((m) => m !== 'coming-up');
  }
  layout.grid = choice.grid;
  const theme: Theme = {
    ...preset,
    family,
    masthead: choice.masthead,
    corners: choice.corners,
    motif: choice.motif,
    palette,
    layout,
    identityNotes: choice.identityNotes,
    ...(choice.tagline ? { tagline: choice.tagline.slice(0, 80) } : {}),
  };
  return { theme: themeSchema.parse(theme), notes };
}

/**
 * Repairs neighbor-rule problems in code: rotates the brand hue away from neighbors' accents,
 * then swaps layout parts a neighbor shares. Throws if it can't (the report shows why).
 */
export function satisfyNeighbors(
  theme: Theme,
  neighbors: Neighbor[],
): { theme: Theme; notes: string[] } {
  const notes: string[] = [];
  let t = theme;
  for (let i = 0; i < 12 && neighbors.some((n) => sharesFamilyAndPalette(t, n.theme)); i++) {
    const c = hexToOklch(t.palette.accent);
    const accent = oklchToHex({ ...c, h: (c.h + 30) % 360 });
    const { palette } = adjustContrast(paletteFromAccent(accent, t.palette.secondary));
    t = { ...t, palette };
    if (i === 0) notes.push('Brand color moved away from a nearby site sharing this family.');
  }
  for (const part of ['header', 'grid', 'article'] as const) {
    if (neighborProblems(t, neighbors).length === 0) break;
    const used = new Set<string>(neighbors.map((n) => n.theme.layout[part]));
    const alt = (layoutOptions[part] as readonly string[]).find(
      (o) => !used.has(o) && o !== t.layout[part],
    );
    if (!alt) continue;
    const layout = { ...t.layout, [part]: alt } as Theme['layout'];
    if (part === 'grid' && alt === 'single-column' && layout.homeRail) {
      layout.home = [...layout.home, ...layout.homeRail];
      delete layout.homeRail;
    }
    const next = themeSchema.safeParse({ ...t, layout });
    if (next.success) {
      t = next.data;
      notes.push(`${part} changed to ${alt} to differ from nearby sites.`);
    }
  }
  const left = neighborProblems(t, neighbors);
  if (left.length) throw new Error(`Neighbor rule: ${left.join('; ')}`);
  return { theme: t, notes };
}

/** A theme choice without a model: deterministic from the town's name, avoiding neighbors. */
export function fallbackChoice(
  town: Pick<ResolvedTown, 'name' | 'state'>,
  neighbors: Neighbor[],
  itemsPerDay: number,
): ThemeChoice {
  const seed = createHash('sha256').update(`${town.name},${town.state}`).digest();
  const families = Object.keys(styleFamilies) as StyleFamily[];
  const nearFamilies = new Set(neighbors.slice(0, 2).map((n) => n.theme.family));
  const family: StyleFamily =
    itemsPerDay < LOW_VOLUME_ITEMS
      ? 'community'
      : (families.find((f) => !nearFamilies.has(f)) ?? families[seed[0]! % families.length]!);
  const preset = familyPresets[family];
  // Hues 30° apart, skipping any within 40° of a neighbor's accent.
  const taken = neighbors.map((n) => hexToOklch(n.theme.palette.accent).h);
  const hues = Array.from({ length: 12 }, (_, i) => (seed[1]! + i * 30) % 360);
  const h =
    hues.find((x) => taken.every((t) => Math.min(Math.abs(x - t), 360 - Math.abs(x - t)) > 40)) ??
    hues[0]!;
  const nearMotifs = new Set(neighbors.map((n) => n.theme.motif));
  const rotated = motifs.map((_, i) => motifs[(seed[2]! + i) % motifs.length]!);
  const motif = rotated.find((m) => !nearMotifs.has(m)) ?? rotated[0]!;
  return {
    identityNotes: `Generated without a model for ${town.name}, ${town.state}: identity research is still to do (see the launch report).`,
    family,
    accent: oklchToHex({ l: 0.45, c: 0.12, h }),
    secondary: null,
    motif,
    masthead: preset.masthead,
    tagline: null,
    header: preset.layout.header,
    grid: preset.layout.grid,
    article: preset.layout.article,
    directory: preset.layout.directory,
    footer: preset.layout.footer,
    corners: preset.corners,
  };
}

export type ThemeDetail = {
  mode: 'model' | 'fallback';
  themeFile: string;
  theme: Theme;
  notes: string[];
  /** The readiness the theme was made for (the content-volume rule depends on it). */
  itemsPerDay?: number;
  neighbors: Array<{ name: string; siteName: string; miles: number }>;
  checks: { contrast: 'pass'; volume: 'pass'; slots: 'pass'; neighbors: 'pass' };
  mastheads: string[];
  /** Screenshots and identity assets, when a running web app was given (--site). */
  shots: Shot[];
  /** The screenshot review passes (Anthropic only; at most two). */
  reviews: Array<{ verdict: ThemeReview['verdict']; problems: string[]; applied: string[] }>;
  /** Logo art: the ChatGPT prompts, and whether art was imported (identity-step.ts). */
  art?: ArtDetail;
};

/** At most this many review-and-fix rounds (docs/plans/M7.md §5). */
export const MAX_REVIEWS = 2;

/** Applies a review's changes in code, keeping every rule; returns what changed. */
export function applyReview(
  theme: Theme,
  review: ThemeReview,
  neighbors: Neighbor[],
): { theme: Theme; applied: string[] } {
  const c = review.changes;
  const applied: string[] = [];
  let t: Theme = { ...theme, layout: { ...theme.layout } };
  if (c.accent && /^#[0-9A-Fa-f]{6}$/.test(c.accent)) {
    t.palette = adjustContrast(paletteFromAccent(c.accent, t.palette.secondary)).palette;
    applied.push(`accent ${t.palette.accent}`);
  }
  if (c.masthead) {
    t.masthead = c.masthead;
    applied.push(`masthead ${c.masthead}`);
  }
  if (c.corners) {
    t.corners = c.corners;
    applied.push(`corners ${c.corners}`);
  }
  for (const part of ['header', 'article', 'footer'] as const) {
    const v = c[part];
    if (v) {
      (t.layout as Record<string, unknown>)[part] = v;
      applied.push(`${part} ${v}`);
    }
  }
  if (c.grid && c.grid !== t.layout.grid) {
    if (c.grid === 'single-column' && t.layout.homeRail) {
      t.layout.home = [...t.layout.home, ...t.layout.homeRail];
      delete t.layout.homeRail;
    }
    t.layout.grid = c.grid;
    applied.push(`grid ${c.grid}`);
  }
  const parsed = themeSchema.safeParse(t);
  if (
    !parsed.success ||
    slotProblems(parsed.data).length ||
    neighborProblems(parsed.data, neighbors).length
  )
    return { theme, applied: [] };
  t = parsed.data;
  return { theme: t, applied };
}

export async function themeStep(input: {
  db: Db;
  llm?: Llm;
  places: (state: string) => Promise<Place[]>;
  town: ResolvedTown;
  names: NamesDetail;
  readiness: ReadinessDetail | undefined;
  launchStartedAt: Date;
  launchDir: string;
  /** A running web app to screenshot (--site); without it the report lists screenshots as to do. */
  shots?: Omit<ShotTarget, 'domain'>;
  /** The theme an earlier run made: kept (re-checked) instead of generating a new one. */
  previous?: ThemeDetail;
}): Promise<{ detail: ThemeDetail; files: string[] }> {
  const { db, town } = input;
  const picked = input.names.picked;
  if (!picked) throw new Error('Step 2 has no picked name.');
  const config: TownConfig = parseTownConfig(
    readFileSync(picked.townFile, 'utf8'),
    picked.townFile,
  );
  const itemsPerDay = input.readiness?.itemsPerDay ?? 0;
  const neighbors = await nearbyThemes(db, input.places, town, defaultTheme);

  let theme: Theme;
  let mode: ThemeDetail['mode'] = 'fallback';
  const notes: string[] = [];
  const low = (n: number) => n < LOW_VOLUME_ITEMS;
  const previous = input.previous;
  // A theme made for a different side of the content-volume line (new sources raised or lowered
  // readiness) is made again; otherwise a re-run keeps it.
  if (previous?.theme && low(previous.itemsPerDay ?? itemsPerDay) === low(itemsPerDay)) {
    // Re-run (screenshots, --redo, new sources): keep the theme already made; the rules are
    // re-checked below, and the volume note shows today's readiness.
    theme = themeSchema.parse(previous.theme);
    mode = previous.mode;
    notes.push(
      ...previous.notes.map((n) =>
        n.replace(/^[\d.]+ items a day is under/, `${itemsPerDay} items a day is under`),
      ),
    );
    if (neighborProblems(theme, neighbors).length) {
      const repaired = satisfyNeighbors(theme, neighbors);
      theme = repaired.theme;
      notes.push(...repaired.notes);
    }
  } else {
    let choice: ThemeChoice;
    if (input.llm) {
      const [row] = await db
        .select({ id: towns.id })
        .from(towns)
        .where(eq(towns.slug, config.slug));
      const { value } = await callModel(input.llm, {
        job: 'launch.theme',
        town: await launchLlmTown(
          db,
          { id: row!.id, timezone: config.timezone },
          input.launchStartedAt,
        ),
        prompt: themeV1,
        input: [
          `Town: ${town.name}, ${town.state} (${town.county} County)`,
          `Site name: ${picked.siteName}`,
          `News items a day: ${itemsPerDay}`,
          neighbors.length
            ? `Nearby sites:\n${neighbors
                .map(
                  (n) =>
                    `- ${n.siteName} (${n.miles} miles): family ${n.theme.family}, accent ${n.theme.palette.accent}, motif ${n.theme.motif}, header ${n.theme.layout.header}, grid ${n.theme.layout.grid}, article ${n.theme.layout.article}`,
                )
                .join('\n')}`
            : 'Nearby sites: none within 50 miles.',
        ].join('\n'),
      });
      if (!/^#[0-9A-Fa-f]{6}$/.test(value.accent))
        throw new Error(`The model's accent "${value.accent}" isn't a #RRGGBB color.`);
      if (value.secondary && !/^#[0-9A-Fa-f]{6}$/.test(value.secondary)) value.secondary = null;
      choice = value;
      mode = 'model';
    } else {
      choice = fallbackChoice(town, neighbors, itemsPerDay);
    }

    const built = buildTheme(choice, { itemsPerDay });
    const repaired = satisfyNeighbors(built.theme, neighbors);
    theme = repaired.theme;
    notes.push(...built.notes, ...repaired.notes);
  }
  for (const problem of slotProblems(theme)) throw new Error(`Slot contract: ${problem}`);
  const townProblems = checkThemeForTown(theme, {
    tier: itemsPerDay < LOW_VOLUME_ITEMS ? 'small' : config.tier,
  });
  if (townProblems.length) throw new Error(`Content volume: ${townProblems.join('; ')}`);
  theme = parseTheme(JSON.stringify(theme));

  const themeFile = picked.townFile.replace(/\.ya?ml$/, '.theme.json');
  const save = async (t: Theme) => {
    writeFileSync(themeFile, `${JSON.stringify(t, null, 2)}\n`);
    await syncTowns(db, [{ config, theme: t, hasThemeFile: true }]);
  };
  await save(theme);

  // Three masthead options for the owner to pick from (§10b): the chosen style first.
  const dir = join(input.launchDir, town.slug);
  mkdirSync(dir, { recursive: true });
  const mastheads = () => [theme.masthead, ...mastheadStyles.filter((s) => s !== theme.masthead)];
  let shots: Shot[] = [];
  const reviews: ThemeDetail['reviews'] = [];
  if (input.shots) {
    const target: ShotTarget = { ...input.shots, domain: config.domain };
    const [row] = await db.select({ id: towns.id }).from(towns).where(eq(towns.slug, config.slug));
    const [article] = await db
      .select({ slug: articles.slug })
      .from(articles)
      .where(and(eq(articles.townId, row!.id), eq(articles.status, 'published')))
      .orderBy(desc(articles.publishedAt))
      .limit(1);
    const pages = [
      { name: 'home', path: '/' },
      ...(article ? [{ name: 'article', path: `/news/${article.slug}` }] : []),
      { name: 'directory', path: '/directory' },
    ];
    const capture = async () => {
      const shotDir = join(dir, 'screenshots');
      return [
        ...(await capturePages(target, shotDir, pages, theme)),
        ...(await captureIdentity(target, join(dir, 'identity'), {
          siteName: config.site_name,
          place: `${town.name}, ${town.state}`,
          theme,
          mastheads: mastheads(),
        })),
      ];
    };
    shots = await capture();
    // The review pass needs a provider that reads images.
    for (let round = 0; input.llm?.provider.images && round < MAX_REVIEWS; round++) {
      const { value } = await callModel(input.llm, {
        job: 'launch.theme-review',
        town: await launchLlmTown(
          db,
          { id: row!.id, timezone: config.timezone },
          input.launchStartedAt,
        ),
        prompt: themeReviewV1,
        input: [
          `Site: ${config.site_name}, ${town.name}, ${town.state}`,
          `Theme: ${JSON.stringify(theme)}`,
          neighbors.length
            ? `Nearby: ${neighbors.map((n) => `${n.siteName} (${n.theme.family}, ${n.theme.palette.accent})`).join('; ')}`
            : 'Nearby: none',
        ].join('\n'),
        images: shots
          .filter((s) => s.viewport !== 'asset')
          .map((s) => ({
            mediaType: 'image/png' as const,
            data: readFileSync(s.path).toString('base64'),
            label: `${s.name} on a ${s.viewport}:`,
          })),
      });
      const { theme: next, applied } =
        value.verdict === 'fix' ? applyReview(theme, value, neighbors) : { theme, applied: [] };
      reviews.push({ verdict: value.verdict, problems: value.problems, applied });
      if (applied.length === 0) break;
      theme = next;
      notes.push(`Review ${round + 1}: ${applied.join(', ')}.`);
      await save(theme);
      shots = await capture();
    }
  }
  // Logo art: ChatGPT prompts from the final theme for the owner, cut in code once imported.
  const art = logoPromptStep({
    config,
    theme,
    place: { name: town.name, state: town.state },
    dir,
  });
  return {
    detail: {
      mode,
      themeFile,
      theme,
      notes,
      itemsPerDay,
      neighbors: neighbors.map(({ name, siteName, miles }) => ({ name, siteName, miles })),
      checks: { contrast: 'pass', volume: 'pass', slots: 'pass', neighbors: 'pass' },
      mastheads: mastheads(),
      shots,
      reviews,
      art,
    },
    files: [themeFile, art.promptFile, ...shots.map((s) => s.path)],
  };
}
