import {
  AI_ILLUSTRATION_LABEL,
  beats,
  entityKey,
  illustrationLibrary,
  illustrationShots,
  imageDefaults,
  roundupImageDefaults,
  type DailyCountsSpec,
  type IllustrationSection,
  type IllustrationShot,
  type ImageKind,
  type LibraryIllustration,
  type ImageSpec,
  type MapSpec,
  type StockPhotoSpec,
  guideTopic,
} from '@towncore/config';
import {
  OSM_ATTRIBUTION,
  OSM_COPYRIGHT_URL,
  OSM_LICENSE,
  searchPhotos,
  trackDownload,
  UNSPLASH_LICENSE,
  type Fetcher,
} from '@towncore/adapters';
import {
  and,
  articleEntities,
  articles,
  businesses,
  entities,
  eq,
  images,
  ne,
  gte,
  inArray,
  records,
  staff,
  storyCandidates,
  townBasemaps,
  towns,
  type Db,
} from '@towncore/db';
import {
  blockLabel,
  buildMapSpec,
  findStreetAddress,
  geocodeBlock,
  mapAlt,
  type BasemapLines,
} from './maps';
import {
  approvedIllustration,
  approvedPhoto,
  businessPhotoFor,
  photoSpec,
  takeReaderPhoto,
  type PhotoSubmission,
} from '@towncore/photos/queries';
import { apDate, isoLocalDate, localMidnight } from './time';

// The image router (CLAUDE.md §11c; docs/plans/M4.md §3). For each article it takes the first
// option on the beat's list that it can build and records the choice; it always ends at the
// typographic card, so every article has a visual. Generated visuals are drawn by us from the
// article's own text and records: no photos from other sites, no image model.

/**
 * Options the router can build today (maps and stock photos need the deps below). Photos people
 * sent us and AI illustrations (M9) come from `photo_submissions`, only once a person approved
 * them. Government images aren't built yet.
 */
const BUILDABLE = new Set<ImageKind>([
  'map',
  'stock',
  'data-graphic',
  'typographic-card',
  'reader-photo',
  'business-photo',
  'ai-illustration',
]);
const PHOTO_OPTIONS = new Set<ImageKind>(['reader-photo', 'business-photo', 'ai-illustration']);

/**
 * What the network options need: the polite Fetcher (Census Geocoder for maps, the Unsplash API
 * for stock photos) and, for stock photos, the Unsplash access key. Without them the router skips
 * those options; the visuals jobs in the worker retry with them.
 */
export type ImageDeps = { fetcher: Fetcher; unsplash?: { accessKey: string } };

type TownForImage = { name: string; state: string };

/** What a roundup's main record type counts, singular and plural. */
export const recordCountLabels: Record<string, [string, string]> = {
  'new-filing': ['new business filing', 'new business filings'],
  license: ['new contractor license', 'new contractor licenses'],
  meeting: ['public meeting', 'public meetings'],
};

/** A data graphic needs at least this many records over at least two days; fewer read better
 * as the card's single figure. */
const MIN_RECORDS = 5;
const MAX_DAYS = 14;

export type ImageChoice = {
  kind: ImageKind;
  spec: ImageSpec;
  alt: string;
  license: string;
  attribution: string | null;
  sourceUrl: string | null;
  /** Set for an AI illustration, with the person who approved it (§11c). */
  aiGenerated?: boolean;
  approvedBy?: string | null;
};

type ArticleForImage = {
  /** Set for an existing article, so a stock photo it already uses isn't counted against it. */
  id?: string;
  townId: string;
  guideTopic?: string | null;
  headline: string;
  dek: string | null;
  bodyMd: string;
  beat: string;
  kind: string;
  sourceRecordIds: string[];
};

/** The beat's list of options, roundups first trying a data graphic. */
export function imageOptions(article: Pick<ArticleForImage, 'beat' | 'kind'>): ImageKind[] {
  const list =
    article.kind === 'roundup'
      ? roundupImageDefaults
      : (imageDefaults[article.kind === 'guide' ? 'guide' : article.beat] ?? ['typographic-card']);
  return list.includes('typographic-card') ? [...list] : [...list, 'typographic-card'];
}

/**
 * Counts per local day of the article's own records of its main type, with empty days filled
 * in. Null when there's too little for a chart (fewer than 5 records, one day, or over 14 days).
 */
export function dailyCounts(
  rows: Array<{ type: string; occurredAt: Date | null }>,
  timeZone: string,
): DailyCountsSpec | null {
  const byType = new Map<string, Date[]>();
  for (const row of rows) {
    if (!row.occurredAt || !recordCountLabels[row.type]) continue;
    byType.set(row.type, [...(byType.get(row.type) ?? []), row.occurredAt]);
  }
  const [type, dates] = [...byType].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  if (!type || !dates || dates.length < MIN_RECORDS) return null;
  const counts = new Map<string, number>();
  for (const d of dates) {
    const day = calendarDay(d, timeZone);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const days = [...counts.keys()].sort();
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const bars: DailyCountsSpec['bars'] = [];
  for (let day = first; day <= last; day = nextDay(day)) {
    bars.push({ date: day, count: counts.get(day) ?? 0 });
    if (bars.length > MAX_DAYS) return null;
  }
  if (bars.length < 2) return null;
  return { type: 'daily-counts', label: recordCountLabels[type]![1], bars, total: dates.length };
}

/**
 * The record's day. State filings and licenses carry a date, not a time, stored as midnight UTC;
 * read in the town's zone that would land on the day before, so they count by their UTC date.
 */
function calendarDay(d: Date, timeZone: string): string {
  const dateOnly =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0;
  return dateOnly ? d.toISOString().slice(0, 10) : isoLocalDate(d, timeZone);
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** "Oct. 5" for an ISO local date in the town's zone. */
function dayLabel(iso: string, timeZone: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return apDate(
    new Date(localMidnight({ y: y!, m: m!, d: d! }, timeZone).getTime() + 12 * 3_600_000),
    timeZone,
  );
}

/** Alt text written from the data the chart shows, every value included. */
export function dailyCountsAlt(spec: DailyCountsSpec, timeZone: string): string {
  const first = dayLabel(spec.bars[0]!.date, timeZone);
  const last = dayLabel(spec.bars[spec.bars.length - 1]!.date, timeZone);
  const values = spec.bars.map((b) => `${dayLabel(b.date, timeZone)}, ${b.count}`).join('; ');
  return `Bar chart of ${spec.label} by day, ${first} to ${last}: ${values}. Total ${spec.total}.`;
}

export function cardAlt(article: Pick<ArticleForImage, 'headline' | 'beat'>): string {
  const label = beats.find((b) => b.slug === article.beat)?.label ?? 'News';
  return `Title card with the headline “${article.headline}” and the ${label} section mark.`;
}

const OWN_WORK = 'own-work';

/**
 * Picks the article's visual: the first option on its list that can be built. Photos people sent
 * us are used only when the choice is recorded (`photos`), since taking a reader photo marks it
 * used; a page drawing an article that has no recorded image yet skips them.
 */
export async function chooseArticleImage(
  db: Db,
  article: ArticleForImage,
  timeZone: string,
  deps?: ImageDeps & { town: TownForImage },
  { photos = false }: { photos?: boolean } = {},
): Promise<ImageChoice> {
  for (const option of imageOptions(article)) {
    if (!BUILDABLE.has(option)) continue;
    if (PHOTO_OPTIONS.has(option) && !photos) continue;
    if (option === 'map' && deps) {
      const map = await buildArticleMap(db, article, deps);
      if (map) {
        return {
          kind: 'map',
          spec: map,
          alt: mapAlt(map, deps.town.name),
          license: OSM_LICENSE,
          attribution: OSM_ATTRIBUTION,
          sourceUrl: OSM_COPYRIGHT_URL,
        };
      }
    }
    if (option === 'reader-photo') {
      const photo = await pickReaderPhoto(db, article);
      if (photo) return photo;
    }
    if (option === 'business-photo') {
      const photo = await pickBusinessPhoto(db, article);
      if (photo) return photo;
    }
    if (option === 'ai-illustration' && article.id) {
      const art = await approvedIllustration(db, article.id);
      if (art) {
        return {
          kind: 'ai-illustration',
          spec: photoSpec(art),
          alt: `${AI_ILLUSTRATION_LABEL}: ${art.alt}`,
          license: art.licenseVersion,
          attribution: AI_ILLUSTRATION_LABEL,
          sourceUrl: null,
          aiGenerated: true,
          approvedBy: art.reviewedBy,
        };
      }
      const section = await pickSectionIllustration(db, { ...article, id: article.id });
      if (section) return section;
    }
    if (option === 'stock' && deps?.unsplash) {
      const photo = await pickStockPhoto(db, article, { ...deps, unsplash: deps.unsplash });
      if (photo) return photo;
    }
    if (option === 'data-graphic' && article.sourceRecordIds.length >= MIN_RECORDS) {
      const rows = await db
        .select({ type: records.type, occurredAt: records.occurredAt })
        .from(records)
        .where(inArray(records.id, article.sourceRecordIds));
      const spec = dailyCounts(rows, timeZone);
      if (spec) {
        return {
          kind: 'data-graphic',
          spec,
          alt: dailyCountsAlt(spec, timeZone),
          license: OWN_WORK,
          attribution: null,
          sourceUrl: null,
        };
      }
    }
    if (option === 'typographic-card') break;
  }
  return {
    kind: 'typographic-card',
    spec: { type: 'card' },
    alt: cardAlt(article),
    license: OWN_WORK,
    attribution: null,
    sourceUrl: null,
  };
}

const photoChoice = (
  kind: 'reader-photo' | 'business-photo',
  row: PhotoSubmission,
): ImageChoice => ({
  kind,
  spec: photoSpec(row),
  alt: row.alt!,
  license: row.licenseVersion,
  attribution: row.credit,
  sourceUrl: null,
});

/**
 * A reader's photo (§11c: community and weather): the one the story already shows while it's
 * still approved, else the town's newest approved photo not used in the last week. The page
 * prints the sender's own caption with it, so it never passes as the scene of the story.
 */
async function pickReaderPhoto(db: Db, article: ArticleForImage): Promise<ImageChoice | null> {
  if (article.id) {
    const [current] = await db
      .select({ kind: images.kind, spec: images.spec })
      .from(images)
      .where(eq(images.articleId, article.id));
    if (current?.kind === 'reader-photo' && current.spec.type === 'photo') {
      const row = await approvedPhoto(db, article.townId, current.spec.photoId);
      if (row) return photoChoice('reader-photo', row);
    }
  }
  const row = await takeReaderPhoto(db, article.townId);
  return row ? photoChoice('reader-photo', row) : null;
}

/**
 * The business's own photo, for a story about one listing: the listing written from one of the
 * story's records, or the one business the story names (two listings with that name: neither).
 */
async function pickBusinessPhoto(db: Db, article: ArticleForImage): Promise<ImageChoice | null> {
  const found = new Set<string>();
  if (article.sourceRecordIds.length > 0) {
    const byRecord = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(
        and(
          eq(businesses.townId, article.townId),
          inArray(businesses.sourceRecordId, article.sourceRecordIds),
        ),
      );
    for (const b of byRecord) found.add(b.id);
  }
  if (article.id) {
    const named = await db
      .select({ key: entities.key })
      .from(articleEntities)
      .innerJoin(entities, eq(entities.id, articleEntities.entityId))
      .where(and(eq(articleEntities.articleId, article.id), eq(entities.kind, 'business')));
    if (named.length > 0) {
      const keys = new Set(named.map((n) => n.key));
      const listings = await db
        .select({ id: businesses.id, name: businesses.name })
        .from(businesses)
        .where(and(eq(businesses.townId, article.townId), eq(businesses.active, true)));
      const byKey = new Map<string, string[]>();
      for (const l of listings) {
        const key = entityKey('business', l.name);
        if (key && keys.has(key)) byKey.set(key, [...(byKey.get(key) ?? []), l.id]);
      }
      for (const ids of byKey.values()) if (ids.length === 1) found.add(ids[0]!);
    }
  }
  // A story about several businesses has no one business's photo.
  if (found.size !== 1) return null;
  const row = await businessPhotoFor(db, [...found][0]!);
  return row ? photoChoice('business-photo', row) : null;
}

/** A map for the story's first street address, at block level, or null. */
async function buildArticleMap(
  db: Db,
  article: ArticleForImage,
  deps: ImageDeps & { town: TownForImage },
): Promise<MapSpec | null> {
  const address = findStreetAddress(
    [article.headline, article.dek ?? '', article.bodyMd].join('\n'),
  );
  if (!address) return null;
  const [basemap] = await db
    .select({ lines: townBasemaps.lines })
    .from(townBasemaps)
    .where(eq(townBasemaps.townId, article.townId));
  if (!basemap) return null;
  const center = await geocodeBlock(deps.fetcher, address, deps.town);
  if (!center) return null;
  const spec = buildMapSpec(
    basemap.lines as BasemapLines,
    center,
    blockLabel(address.number, address.street),
    address.street,
  );
  // A point outside the base map (or with no streets around it) makes no map.
  return spec.lines.some((l) => l.c !== 'water' && l.c !== 'coast') ? spec : null;
}

/**
 * A stock photo for an evergreen guide (§11c: generic topics only, never the scene of a story):
 * the first landscape result for the topic's fixed search that no other article in the town
 * uses, with a description to write the alt text from. Unsplash is told the photo is used.
 */
async function pickStockPhoto(
  db: Db,
  article: ArticleForImage,
  deps: ImageDeps & { unsplash: { accessKey: string } },
): Promise<ImageChoice | null> {
  const query = article.kind === 'guide' ? guideTopic(article.guideTopic ?? '')?.photo : undefined;
  if (!query) return null;
  const results = await searchPhotos(deps.fetcher, deps.unsplash.accessKey, query);
  const used = new Set(
    (
      await db
        .select({ spec: images.spec })
        .from(images)
        .innerJoin(articles, eq(articles.id, images.articleId))
        .where(
          and(
            eq(articles.townId, article.townId),
            eq(images.kind, 'stock'),
            article.id ? ne(images.articleId, article.id) : undefined,
          ),
        )
    ).map((r) => (r.spec as StockPhotoSpec).photoId),
  );
  const photo = results.find(
    (p) => !used.has(p.id) && (p.alt_description ?? p.description ?? '').trim(),
  );
  if (!photo) return null;
  await trackDownload(deps.fetcher, deps.unsplash.accessKey, photo);
  const described = (photo.alt_description ?? photo.description)!.trim().replace(/\.$/, '');
  const spec: StockPhotoSpec = {
    type: 'stock',
    provider: 'unsplash',
    photoId: photo.id,
    src: photo.urls.raw,
    width: photo.width,
    height: photo.height,
    color: photo.color,
    photographer: photo.user.name,
    photographerUrl: photo.user.links.html,
    photoUrl: photo.links.html,
  };
  return {
    kind: 'stock',
    spec,
    alt: `Stock photo: ${described.charAt(0).toLowerCase()}${described.slice(1)}.`,
    license: UNSPLASH_LICENSE,
    attribution: `Photo by ${photo.user.name} on Unsplash`,
    sourceUrl: photo.links.html,
  };
}

/** Chooses and records an article's visual (idempotent: re-running replaces the choice). */
export async function assignArticleImage(
  db: Db,
  articleId: string,
  deps?: ImageDeps,
): Promise<ImageChoice> {
  const [row] = await db
    .select({
      article: articles,
      timezone: towns.timezone,
      townName: towns.name,
      townState: towns.state,
      candidateKind: storyCandidates.kind,
    })
    .from(articles)
    .innerJoin(towns, eq(articles.townId, towns.id))
    .leftJoin(storyCandidates, eq(storyCandidates.id, articles.candidateId))
    .where(eq(articles.id, articleId));
  if (!row) throw new Error(`Unknown article ${articleId}`);
  // Articles written before `articles.kind` existed are roundups if their candidate was.
  const kind = row.candidateKind === 'roundup' ? 'roundup' : row.article.kind;
  const choice = await chooseArticleImage(
    db,
    { ...row.article, kind },
    row.timezone,
    deps && { ...deps, town: { name: row.townName, state: row.townState } },
    { photos: true },
  );
  const values = {
    ...choice,
    articleId,
    aiGenerated: choice.aiGenerated ?? false,
    approvedBy: choice.approvedBy ?? null,
    updatedAt: new Date(),
    // When the router last ran with its network options (maps, stock photos). A run without
    // them (a story approved in review, a guide rewritten) clears it, so the worker's visuals
    // jobs draw the map or photo again instead of leaving the text card for good.
    mapCheckedAt: deps ? new Date() : null,
  };
  await db
    .insert(images)
    .values(values)
    .onConflictDoUpdate({ target: images.articleId, set: values });
  return choice;
}

/** A library illustration isn't shown again in the same town for this long. */
const ILLUSTRATION_REPEAT_DAYS = 14;

// Words too common in guide titles to say what a guide is about.
const GENERIC_TAGS = new Set(
  (
    'city town county government public local of use work works residents resident residential ' +
    'services service state event events new rules law program programs property information'
  ).split(' '),
);

const illustrationWords = (text: string) => new Set(text.toLowerCase().match(/[a-z][a-z-]*/g));

/** A stable small number from a string, so the same story always gets the same pick. */
function stableHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The library illustration for a story (§11c, section illustrations): one made for its section
 * (a guide: any scene its own words name) and region, not shown in the town in the last two weeks, with the most of
 * its keywords in the headline and dek; ties broken by a stable hash, so a story keeps its pick.
 * A story that already shows one keeps it while it's in the library. Null for public safety,
 * which has none, and when nothing fits.
 */
export function chooseLibraryIllustration(input: {
  section: string;
  state: string;
  text: string;
  /** The headline alone: a guide is matched on its title, not its summary. */
  title?: string;
  articleId: string;
  current: string | null;
  recent: ReadonlySet<string>;
  shots?: readonly IllustrationShot[];
  library?: readonly LibraryIllustration[];
}): { shot: IllustrationShot; art: LibraryIllustration } | null {
  const shots = input.shots ?? illustrationShots;
  const library = new Map((input.library ?? illustrationLibrary).map((a) => [a.id, a]));
  const words = illustrationWords(input.text);
  const score = (s: IllustrationShot) => s.tags.filter((t) => words.has(t)).length;
  // A guide explains one thing, so it only takes a scene its own words name ("garbage" → the
  // garbage truck), from any section; otherwise it keeps its title card. Words every guide could
  // share ("city") don't count.
  const guide = input.section === 'guide';
  const titleWords = illustrationWords(input.title ?? input.text);
  const named = (s: IllustrationShot) =>
    s.tags.some((t) => titleWords.has(t) && !GENERIC_TAGS.has(t));
  const titleScore = (s: IllustrationShot) =>
    s.tags.filter((t) => titleWords.has(t) && !GENERIC_TAGS.has(t)).length;
  const fits = shots.filter(
    (s) =>
      library.has(s.id) &&
      (guide ? named(s) : s.sections.includes(input.section as IllustrationSection)) &&
      (s.region === 'any' || s.region === input.state),
  );
  const kept = fits.find((s) => s.id === input.current);
  if (kept) return { shot: kept, art: library.get(kept.id)! };
  const best = fits
    .filter((s) => !input.recent.has(s.id))
    .map((s) => ({
      s,
      score: guide ? titleScore(s) : score(s),
      tie: stableHash(`${input.articleId}:${s.id}`),
    }))
    .sort((a, b) => b.score - a.score || a.tie - b.tie)[0];
  return best ? { shot: best.s, art: library.get(best.s.id)! } : null;
}

/**
 * A story's cover (homepage lead, list thumbnails): its own visual, except that a chart never
 * stands in as the cover (owner, 2026-10-16: "a nice chart but looks terrible as the cover
 * image"). A story whose visual is a chart is covered by its section's illustration, or null
 * (the title card); the chart stays in the article itself.
 */
export async function coverIllustration(
  db: Db,
  article: ArticleForImage & { id: string },
): Promise<ImageChoice | null> {
  return pickSectionIllustration(db, article);
}

async function pickSectionIllustration(
  db: Db,
  article: ArticleForImage & { id: string },
): Promise<ImageChoice | null> {
  if (illustrationLibrary.length === 0) return null;
  const [town] = await db
    .select({ state: towns.state })
    .from(towns)
    .where(eq(towns.id, article.townId));
  const [current] = await db
    .select({ spec: images.spec })
    .from(images)
    .where(eq(images.articleId, article.id));
  const since = new Date(Date.now() - ILLUSTRATION_REPEAT_DAYS * 86_400_000);
  const used = await db
    .select({ spec: images.spec })
    .from(images)
    .innerJoin(articles, eq(images.articleId, articles.id))
    .where(
      and(
        eq(articles.townId, article.townId),
        ne(articles.id, article.id),
        eq(images.kind, 'ai-illustration'),
        gte(images.updatedAt, since),
      ),
    );
  const idOf = (spec: ImageSpec | undefined) =>
    spec?.type === 'illustration' ? spec.illustrationId : null;
  const pick = chooseLibraryIllustration({
    section: article.kind === 'guide' ? 'guide' : article.beat,
    state: town?.state ?? '',
    text: `${article.headline} ${article.dek ?? ''}`,
    title: article.headline,
    articleId: article.id,
    current: idOf(current?.spec),
    recent: new Set(used.map((u) => idOf(u.spec)).filter((id): id is string => id !== null)),
  });
  if (!pick) return null;
  // `images.approved_by` is a staff member (§11c: AI images are approved by a person). An
  // approver who isn't active staff here means the illustration can't be used.
  const [approver] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.email, pick.art.approvedBy.toLowerCase()), eq(staff.active, true)));
  if (!approver) return null;
  return {
    kind: 'ai-illustration',
    spec: {
      type: 'illustration',
      illustrationId: pick.art.id,
      width: pick.art.width,
      height: pick.art.height,
    },
    alt: `${AI_ILLUSTRATION_LABEL}: ${pick.art.alt}`,
    license: ILLUSTRATION_LICENSE,
    attribution: AI_ILLUSTRATION_LABEL,
    sourceUrl: null,
    aiGenerated: true,
    approvedBy: approver.id,
  };
}

/** Made by the publisher with ChatGPT image generation; OpenAI assigns its outputs to the user. */
const ILLUSTRATION_LICENSE = 'own-work (AI-generated with ChatGPT)';
