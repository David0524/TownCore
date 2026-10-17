import { articles, images, staff, towns, eq, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Section illustrations from the network library (CLAUDE.md §11c): generic, labeled, approved
// by a person, matched to the story's section and words, never on public safety, and not
// repeated in a town within two weeks.

const library = vi.hoisted(() => [
  {
    id: 'gov-03',
    width: 1200,
    height: 800,
    alt: 'A gavel on its block.',
    approvedBy: 'owner@towncore.net',
    importedAt: '2026-10-16',
  },
  {
    id: 'gov-05',
    width: 1200,
    height: 800,
    alt: 'A budget binder and a calculator.',
    approvedBy: 'owner@towncore.net',
    importedAt: '2026-10-16',
  },
  {
    id: 'gov-07',
    width: 1200,
    height: 800,
    alt: 'A Mediterranean-style civic building.',
    approvedBy: 'owner@towncore.net',
    importedAt: '2026-10-16',
  },
  {
    id: 'biz-01',
    width: 1200,
    height: 800,
    alt: 'A ribbon across a shop door.',
    approvedBy: 'nobody@towncore.net',
    importedAt: '2026-10-16',
  },
]);
vi.mock('@towncore/config', async (original) => ({
  ...(await original<typeof import('@towncore/config')>()),
  illustrationLibrary: library,
}));

const { assignArticleImage, chooseLibraryIllustration } = await import('../src/images');

describe('choosing a library illustration', () => {
  const base = { state: 'FL', articleId: 'a1', current: null, recent: new Set<string>(), library };

  it("picks the section's best keyword match", () => {
    const pick = chooseLibraryIllustration({
      ...base,
      section: 'government',
      text: 'Council approves budget with lower millage',
    });
    expect(pick?.shot.id).toBe('gov-05');
  });

  it('keeps regional shots to their state and skips recent ones', () => {
    const elsewhere = chooseLibraryIllustration({
      ...base,
      state: 'ME',
      section: 'government',
      text: 'City hall hours change',
    });
    expect(elsewhere?.shot.id).not.toBe('gov-07');
    const fresh = chooseLibraryIllustration({
      ...base,
      section: 'government',
      text: 'Council approves budget',
      recent: new Set(['gov-05']),
    });
    expect(fresh?.shot.id).not.toBe('gov-05');
  });

  it('keeps a story on its current pick and has nothing for public safety', () => {
    expect(
      chooseLibraryIllustration({
        ...base,
        section: 'government',
        text: 'Council approves budget',
        current: 'gov-03',
      })?.shot.id,
    ).toBe('gov-03');
    expect(
      chooseLibraryIllustration({ ...base, section: 'public-safety', text: 'Crash on I-95' }),
    ).toBeNull();
  });

  it('gives a guide a scene its own words name, and nothing unrelated', () => {
    expect(
      chooseLibraryIllustration({ ...base, section: 'guide', text: 'How the city budget works' })
        ?.shot.id,
    ).toBe('gov-05');
    expect(
      chooseLibraryIllustration({ ...base, section: 'guide', text: 'How to get a library card' }),
    ).toBeNull();
  });

  it('is stable for the same story', () => {
    const input = { ...base, section: 'government', text: 'Nothing that matches a tag' };
    expect(chooseLibraryIllustration(input)?.shot.id).toBe(
      chooseLibraryIllustration(input)?.shot.id,
    );
  });
});

describe('the router with the library', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let townId: string;
  let ownerId: string;
  let n = 0;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    const [town] = await db
      .insert(towns)
      .values({
        slug: 'palm',
        name: 'Palm',
        state: 'FL',
        county: 'P',
        timezone: 'America/New_York',
        domain: 'palm.test',
        siteName: 'Palm Square',
        tier: 'small',
        config: {},
      })
      .returning();
    townId = town!.id;
    const [owner] = await db
      .insert(staff)
      .values({ email: 'owner@towncore.net', name: 'Owner', role: 'admin' })
      .returning();
    ownerId = owner!.id;
  });
  afterAll(async () => drop());

  async function story(over: Partial<typeof articles.$inferInsert> = {}) {
    const [a] = await db
      .insert(articles)
      .values({
        townId,
        slug: `s-${++n}`,
        headline: 'Council sets budget and millage rate',
        bodyMd: 'Body.',
        beat: 'government',
        tier: 2,
        status: 'published',
        byline: 'Palm Square Newsroom',
        sourceRecordIds: ['00000000-0000-4000-8000-000000000001'],
        publishedAt: new Date(),
        ...over,
      })
      .returning();
    return a!;
  }

  it('records a labeled, approved illustration instead of the title card', async () => {
    const a = await story();
    const choice = await assignArticleImage(db, a.id);
    expect(choice.kind).toBe('ai-illustration');
    expect(choice.spec).toMatchObject({ type: 'illustration', illustrationId: 'gov-05' });
    expect(choice.alt).toBe('A budget binder and a calculator.');
    const [row] = await db.select().from(images).where(eq(images.articleId, a.id));
    expect(row).toMatchObject({ aiGenerated: true, approvedBy: ownerId });
  });

  it('prefers a scene not shown in the town within two weeks', async () => {
    const choice = await assignArticleImage(
      db,
      (await story({ headline: 'Council approves budget and millage rate' })).id,
    );
    expect(choice.spec).toMatchObject({ illustrationId: 'gov-03' });
  });

  it('repeats a recent scene rather than fall back to the title card', async () => {
    const choice = await assignArticleImage(db, (await story()).id);
    expect(choice.spec).toMatchObject({ illustrationId: 'gov-05' });
  });

  it('never illustrates public safety, and needs an approver on staff', async () => {
    const crash = await story({ beat: 'public-safety', headline: 'Crash closes road', tier: 3 });
    expect((await assignArticleImage(db, crash.id)).kind).toBe('typographic-card');
    // biz-01's approver isn't staff here, so the business story falls back to the card.
    const opening = await story({ beat: 'business', headline: 'Grand opening of a bakery' });
    expect((await assignArticleImage(db, opening.id)).kind).toBe('typographic-card');
  });

  it('keeps a picture a person pinned to the story', async () => {
    const a = await story({ headline: 'New businesses registered this week' });
    const pinned = {
      articleId: a.id,
      kind: 'ai-illustration' as const,
      spec: {
        type: 'illustration' as const,
        illustrationId: 'story-pinned',
        width: 1200,
        height: 800,
        pinned: true,
        photoreal: true,
      },
      alt: 'Storefronts.',
      license: 'own-work',
      attribution: 'Image (AI-generated)',
      aiGenerated: true,
      approvedBy: ownerId,
    };
    await db.insert(images).values(pinned);
    const choice = await assignArticleImage(db, a.id);
    expect(choice.spec).toMatchObject({ illustrationId: 'story-pinned', pinned: true });
    const [row] = await db.select().from(images).where(eq(images.articleId, a.id));
    expect(row!.spec).toMatchObject({ illustrationId: 'story-pinned' });
  });
});
