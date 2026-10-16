import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { basename, extname, join } from 'node:path';
import {
  aiLabel,
  ILLUSTRATION_STYLE,
  illustrationShots,
  type IllustrationSection,
  type LibraryIllustration,
} from '@towncore/config';
import { and, articles, eq, images, inArray, staff, type Db } from '@towncore/db';
import { assignArticleImage, ILLUSTRATION_LICENSE } from '@towncore/pipeline';
import { processIllustration } from '@towncore/photos';

// Section illustrations (CLAUDE.md §11c): the shot list, importing the owner's approved images,
// and giving stories that only have a title card one of them. Run through
// `pnpm illustrations <shotlist|import|assign>` (illustrations-cli.ts).

const SECTION_TITLES: Record<IllustrationSection, string> = {
  government: 'Government and city services',
  development: 'Development, permits and roads',
  business: 'Business and dining',
  schools: 'Schools',
  community: 'Community, parks and events',
  weather: 'Weather',
  guide: 'Guides (how-to topics)',
};

/** The shot list the owner works from in ChatGPT, generated from packages/config. */
export function shotListMarkdown(): string {
  const lines = [
    '# Section illustration shot list',
    '',
    `${illustrationShots.length} illustrations for the network-wide library (CLAUDE.md §11c). Generated from \`packages/config/src/illustrations.ts\` by \`pnpm illustrations shotlist\`; edit that file, not this one.`,
    '',
    '## How to make them in ChatGPT',
    '',
    '1. Start a new chat and paste the **style** below, then: "Make one landscape image (1536×1024) for each scene I send, in exactly this style. Reply with only the image."',
    '2. Send one scene at a time, as written (ID first, so you can see which is which).',
    '3. Re-paste the style every 10 images or so, or if the look drifts (text appearing, photo-like images, faces).',
    '4. Redo any image with words, logos, readable signs, faces up close, or a real recognizable building. Those are the rules that keep them honest.',
    '5. Save each image named by its ID, e.g. `gov-01.png`. If names get mixed up, keep them in order; I can match them by looking.',
    '6. Zip them and attach the zip to a GitHub draft release, as with the map file. I review each one, write its alt text and import it.',
    '',
    'Skipping a scene is fine; the library works with whatever is imported. Regions: **FL** scenes (palms, beaches) are used only for Florida towns; **any** fits every town.',
    '',
    '## Style (paste first)',
    '',
    '```',
    ILLUSTRATION_STYLE,
    '```',
    '',
  ];
  for (const section of Object.keys(SECTION_TITLES) as IllustrationSection[]) {
    const shots = illustrationShots.filter((s) => s.sections[0] === section);
    if (shots.length === 0) continue;
    lines.push(`## ${SECTION_TITLES[section]} (${shots.length})`, '');
    for (const s of shots) lines.push(`- **${s.id}** (${s.region}): ${s.scene}`);
    lines.push('');
  }
  return lines.join('\n');
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export type ImportResult = { imported: string[]; skipped: Array<{ file: string; why: string }> };

/**
 * Imports the owner's illustrations: each file named by its shot ID is re-encoded to
 * <webDir>/<id>.webp and recorded in the library with its alt text (written from what the
 * image shows) and approver. Files without a known ID or alt text are skipped, not guessed.
 */
export async function importIllustrations(opts: {
  dir: string;
  alts: Record<string, string>;
  approvedBy: string;
  library: readonly LibraryIllustration[];
  webDir: string;
  now?: Date;
}): Promise<{ result: ImportResult; library: LibraryIllustration[] }> {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(opts.approvedBy)) {
    throw new Error(`--approved-by needs the approver's email, not "${opts.approvedBy}"`);
  }
  const ids = new Set(illustrationShots.map((s) => s.id));
  const library = new Map(opts.library.map((a) => [a.id, a]));
  const result: ImportResult = { imported: [], skipped: [] };
  for (const file of (await readdir(opts.dir)).sort()) {
    if (!IMAGE_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    const id = basename(file, extname(file)).toLowerCase();
    if (!ids.has(id)) {
      result.skipped.push({ file, why: 'not a shot ID' });
      continue;
    }
    const alt = opts.alts[id]?.trim();
    if (!alt) {
      result.skipped.push({ file, why: 'no alt text' });
      continue;
    }
    try {
      const { webp, width, height } = await processIllustration(
        await readFile(join(opts.dir, file)),
      );
      await writeFile(join(opts.webDir, `${id}.webp`), webp);
      library.set(id, {
        id,
        width,
        height,
        alt,
        approvedBy: opts.approvedBy.toLowerCase(),
        importedAt: (opts.now ?? new Date()).toISOString().slice(0, 10),
      });
      result.imported.push(id);
    } catch (error) {
      result.skipped.push({ file, why: error instanceof Error ? error.message : String(error) });
    }
  }
  return { result, library: [...library.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}

/** The library file's source, formatted by the repo's Prettier afterwards. */
export function librarySource(library: readonly LibraryIllustration[]): string {
  return [
    "import type { LibraryIllustration } from './illustrations';",
    '',
    '// The imported section illustrations (CLAUDE.md §11c), written by `pnpm illustrations import`.',
    "// Each file is apps/web/public/illustrations/<id>.webp. Edit alt text here if it's wrong.",
    `export const illustrationLibrary: readonly LibraryIllustration[] = ${JSON.stringify(library, null, 2)};`,
    '',
  ].join('\n');
}

export function formatWithPrettier(root: string, files: string[]): void {
  execFileSync('pnpm', ['exec', 'prettier', '--write', ...files], { cwd: root, stdio: 'ignore' });
}

/**
 * Stories showing only a title card get the router run again, so they can take a section
 * illustration now that the library has some. Everything else keeps its image.
 */
export async function assignIllustrations(
  db: Db,
  { townId }: { townId?: string } = {},
): Promise<{ tried: number; illustrated: number }> {
  const rows = await db
    .select({ id: articles.id })
    .from(articles)
    .innerJoin(images, eq(images.articleId, articles.id))
    .where(
      and(
        inArray(articles.status, ['published', 'corrected', 'in_review']),
        eq(images.kind, 'typographic-card'),
        townId ? eq(articles.townId, townId) : undefined,
      ),
    );
  let illustrated = 0;
  for (const row of rows) {
    const choice = await assignArticleImage(db, row.id);
    if (choice.spec.type === 'illustration') illustrated++;
  }
  return { tried: rows.length, illustrated };
}

/**
 * Pins a picture a person chose to one story (owner, 2026-10-16: "Use this as the image for the
 * cover story"): converted like the library, saved as /illustrations/<id>.webp, recorded as
 * AI-generated with its approver and alt text, labeled, and kept by the router from then on.
 */
export async function pinIllustration(
  db: Db,
  opts: {
    townId: string;
    articleSlug: string;
    file: Buffer;
    alt: string;
    approvedBy: string;
    photoreal: boolean;
    webDir: string;
  },
): Promise<{ id: string; articleId: string }> {
  const alt = opts.alt.trim();
  if (!alt) throw new Error('--alt is required: describe what the picture shows');
  const [article] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.townId, opts.townId), eq(articles.slug, opts.articleSlug)));
  if (!article) throw new Error(`no story ${opts.articleSlug} in that town`);
  const [approver] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.email, opts.approvedBy.toLowerCase()), eq(staff.active, true)));
  if (!approver) throw new Error(`${opts.approvedBy} isn't active staff, so can't approve it`);
  const { webp, width, height } = await processIllustration(opts.file);
  const id = `story-${article.id.slice(0, 8)}`;
  await writeFile(join(opts.webDir, `${id}.webp`), webp);
  const label = aiLabel({ photoreal: opts.photoreal });
  const values = {
    articleId: article.id,
    kind: 'ai-illustration' as const,
    spec: {
      type: 'illustration' as const,
      illustrationId: id,
      width,
      height,
      pinned: true,
      ...(opts.photoreal ? { photoreal: true } : {}),
    },
    alt: `${label}: ${alt}`,
    license: ILLUSTRATION_LICENSE,
    attribution: label,
    sourceUrl: null,
    aiGenerated: true,
    approvedBy: approver.id,
    mapCheckedAt: new Date(),
    updatedAt: new Date(),
  };
  await db
    .insert(images)
    .values(values)
    .onConflictDoUpdate({ target: images.articleId, set: values });
  return { id, articleId: article.id };
}
