import { randomUUID } from 'node:crypto';
import { AI_ILLUSTRATION_LABEL, guideTopic } from '@towncore/config';
import { and, articles, eq, photoSubmissions, towns, type Db } from '@towncore/db';
import { processPhoto } from './process';
import type { PhotoSubmission } from './queries';
import type { PhotoStorage } from './storage';

// AI illustrations for evergreen guides (M9, CLAUDE.md §11c; docs/plans/M9.md §4). An image model
// is a new paid service, so none is configured until the owner picks one (D-M9-4); this is the
// path one plugs into. Every illustration waits in Admin → Photos for a person to approve it,
// is labeled "Illustration (AI-generated)" wherever it shows, and is recorded as AI-generated.

export interface IllustrationProvider {
  /** The service's name, recorded with each illustration. */
  readonly name: string;
  /** The license or terms the service grants for its output, recorded with each illustration. */
  readonly terms: string;
  /** One image for the prompt (JPEG, PNG or WebP). */
  illustrate(prompt: string): Promise<Uint8Array>;
}

/**
 * The prompt for a guide's illustration: clearly an illustration, never a photo; no people, no
 * text, and no real place drawn as if photographed (§11c).
 */
export function illustrationPrompt(subject: string): string {
  return [
    `A simple flat editorial illustration about: ${subject}.`,
    'Clearly an illustration, not a photograph: flat shapes, limited palette, no photographic detail.',
    'No people or faces, no text or lettering, no logos, no real landmarks or recognizable real places.',
    'Wide 16:9 composition with a calm, uncluttered background.',
  ].join(' ');
}

export class IllustrationError extends Error {}

/** Asks the provider for a guide's illustration and queues it for a person to approve. */
export async function requestIllustration(
  db: Db,
  storage: PhotoStorage,
  provider: IllustrationProvider,
  articleId: string,
  now = new Date(),
): Promise<PhotoSubmission> {
  const [row] = await db
    .select({ article: articles, siteName: towns.siteName })
    .from(articles)
    .innerJoin(towns, eq(towns.id, articles.townId))
    .where(eq(articles.id, articleId));
  if (!row || row.article.kind !== 'guide')
    throw new IllustrationError('Illustrations are made for evergreen guides only.');
  const [waiting] = await db
    .select({ id: photoSubmissions.id })
    .from(photoSubmissions)
    .where(and(eq(photoSubmissions.articleId, articleId), eq(photoSubmissions.status, 'pending')));
  if (waiting) throw new IllustrationError('An illustration for this guide is already waiting.');
  const subject = guideTopic(row.article.guideTopic ?? '')?.title ?? row.article.headline;
  const prompt = illustrationPrompt(subject);
  const { jpeg, width, height } = await processPhoto(await provider.illustrate(prompt));
  const key = `photos/${row.article.townId}/${randomUUID()}.jpg`;
  await storage.put(key, jpeg);
  const [saved] = await db
    .insert(photoSubmissions)
    .values({
      townId: row.article.townId,
      articleId,
      kind: 'illustration',
      storageKey: key,
      width,
      height,
      bytes: jpeg.byteLength,
      caption: `For the guide "${row.article.headline}". Prompt: ${prompt}`,
      credit: AI_ILLUSTRATION_LABEL,
      submitterName: provider.name,
      submitterEmail: 'illustrations@towncore.net',
      licenseVersion: `ai:${provider.name}`,
      licenseText: provider.terms,
      consentAt: now,
      createdAt: now,
    })
    .returning();
  return saved!;
}
