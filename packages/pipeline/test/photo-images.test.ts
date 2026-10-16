import { entityKey } from '@towncore/config';
import {
  articleEntities,
  articles,
  businesses,
  entities,
  images,
  photoSubmissions,
  staff,
  towns,
  eq,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assignArticleImage } from '../src/images';

// The image router with photos people sent us (M9, CLAUDE.md §11c): only approved ones, a
// reader photo not reused within a week, a business's own photo only for a story about that one
// business, and an AI illustration only once a person approved it, labeled.

const NOW = new Date();
let db: Db;
let drop: () => Promise<void>;
let townId: string;
let staffId: string;
let n = 0;

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  const [town] = await db
    .insert(towns)
    .values({
      slug: 'harbor',
      name: 'Harbor',
      state: 'ZZ',
      county: 'S',
      timezone: 'America/New_York',
      domain: 'harbor.test',
      siteName: 'Harbor Square',
      tier: 'small',
      config: {},
    })
    .returning();
  townId = town!.id;
  const [member] = await db
    .insert(staff)
    .values({ email: 'ed@towncore.net', name: 'Ed', role: 'reviewer' })
    .returning();
  staffId = member!.id;
});
afterAll(async () => drop());

async function story(over: Partial<typeof articles.$inferInsert> = {}) {
  const [a] = await db
    .insert(articles)
    .values({
      townId,
      slug: `s-${++n}`,
      headline: 'A story',
      bodyMd: 'Body.',
      beat: 'community',
      tier: 1,
      status: 'published',
      byline: 'Harbor Square Newsroom',
      sourceRecordIds: ['00000000-0000-4000-8000-000000000001'],
      publishedAt: NOW,
      ...over,
    })
    .returning();
  return a!;
}

async function photo(over: Partial<typeof photoSubmissions.$inferInsert> = {}) {
  const [p] = await db
    .insert(photoSubmissions)
    .values({
      townId,
      kind: 'reader',
      storageKey: `photos/${townId}/${++n}.jpg`,
      width: 1600,
      height: 1200,
      bytes: 1000,
      caption: 'Sunrise over the inlet',
      credit: 'Photo: Pat Reader',
      submitterName: 'Pat',
      submitterEmail: 'pat@reader.test',
      licenseVersion: 'reader-v1',
      licenseText: 'grant',
      consentAt: NOW,
      ...over,
    })
    .returning();
  return p!;
}
const approved = {
  status: 'approved' as const,
  alt: 'The sun rising over the inlet.',
  reviewedBy: '',
};

describe('reader photos', () => {
  it('uses only approved photos, keeps a story’s photo, and does not reuse one within a week', async () => {
    await photo(); // pending: never used
    expect((await assignArticleImage(db, (await story()).id)).kind).toBe('typographic-card');

    const sunrise = await photo({ ...approved, reviewedBy: staffId });
    const first = await story();
    const choice = await assignArticleImage(db, first.id);
    expect(choice).toMatchObject({
      kind: 'reader-photo',
      alt: 'The sun rising over the inlet.',
      attribution: 'Photo: Pat Reader',
      license: 'reader-v1',
      spec: { type: 'photo', photoId: sunrise.id, caption: 'Sunrise over the inlet' },
    });
    // Re-running the router keeps the story's photo.
    expect((await assignArticleImage(db, first.id)).spec).toMatchObject({ photoId: sunrise.id });
    // Another story the same week doesn't get it again.
    expect((await assignArticleImage(db, (await story({ beat: 'weather' })).id)).kind).toBe(
      'typographic-card',
    );
    // Not on beats where a reader photo could pass as the scene.
    expect((await assignArticleImage(db, (await story({ beat: 'public-safety' })).id)).kind).toBe(
      'typographic-card',
    );
  });
});

describe('business photos', () => {
  it('shows a listing’s own approved photo on a story about that one business', async () => {
    const [cafe] = await db
      .insert(businesses)
      .values({
        townId,
        slug: 'harbor-cafe',
        name: 'Harbor Cafe',
        category: 'restaurants',
        licenseVerified: true,
        dataSource: 'test',
        active: true,
      })
      .returning();
    const shot = await photo({
      kind: 'business',
      businessId: cafe!.id,
      credit: 'Photo: Harbor Cafe',
      licenseVersion: 'business-v1',
      ...approved,
      alt: 'The cafe’s counter with a chalkboard menu.',
      reviewedBy: staffId,
    });
    const opening = await story({ beat: 'business', headline: 'Harbor Cafe opens' });
    // Without the business named, the story gets the card.
    expect((await assignArticleImage(db, opening.id)).kind).toBe('typographic-card');
    const [entity] = await db
      .insert(entities)
      .values({
        townId,
        kind: 'business',
        name: 'Harbor Cafe',
        key: entityKey('business', 'Harbor Cafe')!,
        slug: 'harbor-cafe',
      })
      .returning();
    await db
      .insert(articleEntities)
      .values({ articleId: opening.id, entityId: entity!.id, mention: 'Harbor Cafe' });
    expect(await assignArticleImage(db, opening.id)).toMatchObject({
      kind: 'business-photo',
      attribution: 'Photo: Harbor Cafe',
      spec: { photoId: shot.id },
    });
  });
});

describe('AI illustrations', () => {
  it('appear on a guide only once approved, and are recorded as AI-generated', async () => {
    const guide = await story({ kind: 'guide', guideTopic: 'recycling', beat: 'community' });
    const art = await photo({
      kind: 'illustration',
      articleId: guide.id,
      credit: 'Illustration (AI-generated)',
      licenseVersion: 'ai:test',
    });
    expect((await assignArticleImage(db, guide.id)).kind).toBe('typographic-card');
    await db
      .update(photoSubmissions)
      .set({ status: 'approved', alt: 'Recycling bins drawn in flat shapes.', reviewedBy: staffId })
      .where(eq(photoSubmissions.id, art.id));
    expect(await assignArticleImage(db, guide.id)).toMatchObject({
      kind: 'ai-illustration',
      alt: 'Recycling bins drawn in flat shapes.',
      aiGenerated: true,
      approvedBy: staffId,
    });
    const [row] = await db.select().from(images).where(eq(images.articleId, guide.id));
    expect(row).toMatchObject({ aiGenerated: true, approvedBy: staffId });
  });
});
