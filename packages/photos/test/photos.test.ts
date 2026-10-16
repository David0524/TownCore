import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  adminActions,
  articles,
  businesses,
  eq,
  images,
  staff,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  approvedPhoto,
  businessPhotoFor,
  decidePhoto,
  IllustrationError,
  localPhotoStorage,
  pendingPhotos,
  PhotoDecisionError,
  PhotoRejected,
  processPhoto,
  requestIllustration,
  submitPhoto,
  takeReaderPhoto,
} from '../src';

// M9 (docs/plans/M9.md): re-encoding strips metadata, submissions carry their license grant,
// nothing shows before staff approve it with alt text, and the router doesn't reuse a photo.

const NOW = new Date('2026-10-16T15:00:00Z');

/** A real JPEG with EXIF GPS and camera fields, like a phone photo. */
async function phonePhoto(width = 1600, height = 1200) {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 200 } } })
      .jpeg()
      .withExif({
        IFD0: { Make: 'PhoneCo', Model: 'P1', Copyright: 'Pat' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '26/1 27/1 0/1',
          GPSLongitudeRef: 'W',
          GPSLongitude: '80/1 4/1 0/1',
        },
      })
      .toBuffer(),
  );
}

describe('re-encoding', () => {
  it('strips EXIF and GPS, keeps the picture, caps the size', async () => {
    const input = await phonePhoto(3000, 2000);
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const { jpeg, width, height } = await processPhoto(input);
    const meta = await sharp(jpeg).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect([width, height]).toEqual([2000, 1333]);
  });

  it('refuses what is not a photo, or too small', async () => {
    await expect(processPhoto(new TextEncoder().encode('<svg/>'))).rejects.toThrow(PhotoRejected);
    await expect(processPhoto(await phonePhoto(400, 300))).rejects.toThrow(/too small/);
    await expect(processPhoto(new Uint8Array())).rejects.toThrow(/No photo/);
  });
});

describe('submissions', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let townId: string;
  let bizId: string;
  let staffId: string;
  const storage = localPhotoStorage(mkdtempSync(join(tmpdir(), 'photos-')));
  const reader = async (over: Partial<Parameters<typeof submitPhoto>[2]> = {}) =>
    submitPhoto(db, storage, {
      townId,
      kind: 'reader',
      bytes: await phonePhoto(),
      caption: 'Sunrise over the inlet',
      takenWhere: 'Boca Inlet',
      takenWhen: 'Oct. 15',
      credit: 'Photo: Pat Reader',
      name: 'Pat Reader',
      email: 'pat@reader.test',
      agreed: true,
      ip: '203.0.113.9',
      now: NOW,
      ...over,
    });

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
    const [biz] = await db
      .insert(businesses)
      .values({
        townId,
        slug: 'cafe',
        name: 'Cafe',
        category: 'restaurants',
        licenseVerified: true,
        dataSource: 'test',
        active: true,
      })
      .returning();
    bizId = biz!.id;
    const [member] = await db
      .insert(staff)
      .values({ email: 'editor@towncore.net', name: 'Editor', role: 'reviewer' })
      .returning();
    staffId = member!.id;
  });
  afterAll(async () => drop());

  it('stores the photo stripped, with the license grant the sender accepted', async () => {
    await expect(reader({ agreed: false })).rejects.toThrow(/agree to the license/);
    await expect(reader({ email: 'nope' })).rejects.toThrow(/working email/);
    const row = await reader();
    expect(row).toMatchObject({
      status: 'pending',
      kind: 'reader',
      width: 1600,
      height: 1200,
      credit: 'Photo: Pat Reader',
      licenseVersion: 'reader-v1',
      consentIp: '203.0.113.9',
    });
    expect(row.licenseText).toContain('I give Harbor Square a non-exclusive, royalty-free license');
    const stored = await storage.get(row.storageKey);
    expect((await sharp(stored!).metadata()).exif).toBeUndefined();
    // Pending photos are never served.
    expect(await approvedPhoto(db, townId, row.id)).toBeNull();
    expect((await pendingPhotos(db)).map((p) => p.photo.id)).toContain(row.id);
  });

  it('limits a sender to 5 photos an hour', async () => {
    for (let i = 0; i < 3; i++) await reader();
    await reader({ email: 'other@reader.test' });
    await expect(reader({ email: 'third@reader.test' })).rejects.toThrow(/enough photos for now/);
  });

  it('shows a photo only after a reviewer approves it with alt text; audited', async () => {
    const [first] = (await pendingPhotos(db)).map((p) => p.photo);
    await expect(
      decidePhoto(db, { id: first!.id, staff: { id: staffId }, decision: 'approve', alt: 'sun' }),
    ).rejects.toThrow(PhotoDecisionError);
    const approved = await decidePhoto(
      db,
      {
        id: first!.id,
        staff: { id: staffId },
        decision: 'approve',
        alt: 'The sun rising over the inlet jetty, with a fishing boat heading out.',
      },
      NOW,
    );
    expect(approved).toMatchObject({ status: 'approved', reviewedBy: staffId });
    expect(await approvedPhoto(db, townId, first!.id)).toMatchObject({ id: first!.id });
    expect(await approvedPhoto(db, '00000000-0000-4000-8000-000000000000', first!.id)).toBeNull();
    await expect(
      decidePhoto(db, { id: first!.id, staff: { id: staffId }, decision: 'reject' }),
    ).rejects.toThrow(/already decided/);
    const audit = await db.select().from(adminActions);
    expect(audit.map((a) => a.action)).toContain('photo.approve');

    // The router takes it once, then not again within a week.
    expect((await takeReaderPhoto(db, townId, NOW))!.id).toBe(first!.id);
    expect(await takeReaderPhoto(db, townId, new Date(NOW.getTime() + 86_400_000))).toBeNull();
    expect((await takeReaderPhoto(db, townId, new Date(NOW.getTime() + 8 * 86_400_000)))!.id).toBe(
      first!.id,
    );
  });

  it('business photos belong to a listing, with the business license, at most 5', async () => {
    const biz = (n: number) =>
      submitPhoto(db, storage, {
        townId,
        kind: 'business',
        businessId: bizId,
        bytes: undefined as never,
        caption: `Dining room ${n}`,
        credit: 'Photo: Cafe',
        name: 'Owner',
        email: 'owner@cafe.test',
        agreed: true,
        now: NOW,
      });
    const bytes = await phonePhoto();
    const rows = [];
    for (let i = 0; i < 5; i++)
      rows.push(await submitPhoto(db, storage, { ...(await argsFor(i)), bytes }));
    async function argsFor(i: number) {
      return {
        townId,
        kind: 'business' as const,
        businessId: bizId,
        bytes,
        caption: `Dining room ${i}`,
        credit: 'Photo: Cafe',
        name: 'Owner',
        email: 'owner@cafe.test',
        agreed: true,
        now: NOW,
      };
    }
    expect(rows[0]!.licenseVersion).toBe('business-v1');
    await expect(biz(6)).rejects.toThrow(/at most 5 photos/);
    expect(await businessPhotoFor(db, bizId)).toBeNull();
    await decidePhoto(db, {
      id: rows[2]!.id,
      staff: { id: staffId },
      decision: 'approve',
      alt: 'The dining room with six wooden tables by the window.',
    });
    expect((await businessPhotoFor(db, bizId))!.id).toBe(rows[2]!.id);
  });

  it('queues an AI illustration for a guide; once approved it shows, recorded as AI-generated', async () => {
    const prompts: string[] = [];
    const provider = {
      name: 'test-model',
      terms: 'Output may be used commercially.',
      illustrate: async (prompt: string) => {
        prompts.push(prompt);
        return phonePhoto(1600, 900);
      },
    };
    const make = async (kind: 'guide' | 'story') => {
      const [a] = await db
        .insert(articles)
        .values({
          townId,
          slug: `a-${kind}`,
          headline: kind === 'guide' ? 'How recycling works in Harbor' : 'A story',
          bodyMd: 'Body.',
          beat: 'community',
          tier: 1,
          status: 'published',
          byline: 'Harbor Square Newsroom',
          sourceRecordIds: ['00000000-0000-4000-8000-000000000001'],
          kind,
          guideTopic: kind === 'guide' ? 'recycling' : null,
          publishedAt: NOW,
        })
        .returning();
      return a!;
    };
    const story = await make('story');
    await expect(requestIllustration(db, storage, provider, story.id, NOW)).rejects.toThrow(
      IllustrationError,
    );
    const guide = await make('guide');
    const art = await requestIllustration(db, storage, provider, guide.id, NOW);
    expect(prompts[0]).toContain('Recycling');
    expect(prompts[0]).toContain('not a photograph');
    expect(prompts[0]).toContain('No people');
    expect(art).toMatchObject({
      kind: 'illustration',
      status: 'pending',
      credit: 'Illustration (AI-generated)',
      licenseVersion: 'ai:test-model',
    });
    await expect(requestIllustration(db, storage, provider, guide.id, NOW)).rejects.toThrow(
      /already waiting/,
    );
    expect(await db.select().from(images).where(eq(images.articleId, guide.id))).toEqual([]);
    await decidePhoto(db, {
      id: art.id,
      staff: { id: staffId },
      decision: 'approve',
      alt: 'Blue and green recycling bins drawn in flat shapes.',
    });
    const [image] = await db.select().from(images).where(eq(images.articleId, guide.id));
    expect(image).toMatchObject({
      kind: 'ai-illustration',
      aiGenerated: true,
      approvedBy: staffId,
      attribution: 'Illustration (AI-generated)',
      alt: 'Blue and green recycling bins drawn in flat shapes.',
    });
  });
});
