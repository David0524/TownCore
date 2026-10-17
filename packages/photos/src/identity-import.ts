import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { and, eq, identityArt, logAdminAction, staff, towns, type Db } from '@towncore/db';
import sharp from 'sharp';
import { parseDocument } from 'yaml';
import { deriveIdentityAssets, writeIdentityAssets, type Region } from './identity-assets';

// `pnpm identity import <town> <image> --approved-by <email>` (owner, 2026-10-17): the logo art
// the owner made in ChatGPT from the launch report's prompt becomes the town's hero, icons and
// share images, cut in code. Recorded as AI-generated with the staff member who approved it, and
// audited. Towns without imported art keep the masthead and motif icons drawn in code.

export class IdentityImportError extends Error {}

export const CHATGPT_SOURCE = 'ChatGPT, made by the owner';
/** OpenAI's terms assign the output to the user; the owner made it for TownCore. */
export const CHATGPT_LICENSE =
  'Generated with ChatGPT; output owned by the user under OpenAI’s terms of use, made for TownCore.';

/** Writes the art's config values into a town YAML, keeping its comments and order. */
export function writeArtConfig(
  townFile: string,
  values: { hero_art: { src: string; width: number; height: number }; app_icon: string },
): void {
  const doc = parseDocument(readFileSync(townFile, 'utf8'));
  doc.set('hero_art', values.hero_art);
  doc.set('app_icon', values.app_icon);
  writeFileSync(townFile, doc.toString({ flowCollectionPadding: false }));
}

export async function importIdentityArt(
  db: Db,
  input: {
    slug: string;
    /** The image the owner made (PNG, WebP or JPEG). */
    file: string;
    approvedBy: string;
    /** apps/web/public: assets go to brand/<slug>/ in it. */
    publicDir: string;
    /** The town's YAML, updated with hero_art and app_icon. */
    townFile?: string;
    region?: Region;
    source?: string;
    license?: string;
  },
) {
  const [town] = await db.select().from(towns).where(eq(towns.slug, input.slug));
  if (!town)
    throw new IdentityImportError(`No town ${input.slug}; run towns:sync or the launch first.`);
  const [person] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.email, input.approvedBy.trim().toLowerCase()), eq(staff.active, true)));
  if (!person)
    throw new IdentityImportError(
      `${input.approvedBy} isn't an active staff member; a staff member approves logo art.`,
    );
  const bytes = new Uint8Array(readFileSync(input.file));
  const meta = await sharp(bytes)
    .metadata()
    .catch(() => null);
  if (!meta || !['png', 'webp', 'jpeg'].includes(meta.format ?? ''))
    throw new IdentityImportError('The art must be a PNG, WebP or JPEG image.');
  if ((input.region?.width ?? meta.width!) < 800)
    throw new IdentityImportError('The art is too small: export it at least 800 pixels wide.');

  const assetDir = `/brand/${input.slug}`;
  const values = writeIdentityAssets(
    join(input.publicDir, 'brand', input.slug),
    assetDir,
    await deriveIdentityAssets(bytes, input.region),
  );
  if (input.townFile) writeArtConfig(input.townFile, values);
  await db
    .update(towns)
    .set({ config: { ...(town.config as object), ...values }, updatedAt: new Date() })
    .where(eq(towns.id, town.id));
  const [row] = await db
    .insert(identityArt)
    .values({
      townId: town.id,
      source: input.source ?? CHATGPT_SOURCE,
      license: input.license ?? CHATGPT_LICENSE,
      fileName: basename(input.file),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      width: meta.width!,
      height: meta.height!,
      assetDir,
      aiGenerated: true,
      approvedBy: person.id,
    })
    .returning();
  await logAdminAction(db, {
    staffId: person.id,
    action: 'identity_art.import',
    target: { type: 'town', id: town.id },
    detail: { artId: row!.id, file: row!.fileName, ...values },
  });
  return { art: row!, config: values };
}
