import { fileURLToPath } from 'node:url';
import { entityKey, loadTowns } from '@towncore/config';
import {
  articleEntities,
  articleLinks,
  articles,
  entities,
  eq,
  getTownBySlug,
  syncTowns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { entitiesV1, type EntitiesResult } from '@towncore/prompts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { acceptEntities, extractEntitiesForTown, relatedArticleIds } from '../src/entities';
import type { Llm, LlmProvider, LlmResponse } from '../src/llm';

// Entities and related coverage (CLAUDE.md §6a; docs/plans/M4.md §4).
const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));
const NOW = new Date('2026-10-17T15:00:00Z');
const BODY =
  'The Boca Raton City Council voted 4-1 to resurface Palmetto Park Road. Mayor Jane Doe said Acme Paving LLC starts Nov. 2 near Boca Raton High School.';

let db: Db;
let drop: () => Promise<void>;
let townId: string;

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  const loaded = loadTowns(townsDir).filter((t) => t.config.slug === 'boca-raton');
  await syncTowns(
    db,
    loaded.map((t) => ({ ...t, config: { ...t.config, sources: [] } })),
  );
  townId = (await getTownBySlug(db, 'boca-raton'))!.id;
});
afterAll(async () => drop());
beforeEach(async () => {
  await db.delete(articleLinks);
  await db.delete(articles);
  await db.delete(entities);
});

let n = 0;
async function story(over: Partial<typeof articles.$inferInsert> = {}) {
  n++;
  const [a] = await db
    .insert(articles)
    .values({
      townId,
      slug: `story-${n}`,
      headline: 'Council approves paving for Palmetto Park Road',
      dek: null,
      bodyMd: BODY,
      beat: 'government',
      tier: 2,
      status: 'published',
      byline: 'Boca Town Square Newsroom (AI-assisted)',
      sourceRecordIds: ['00000000-0000-4000-8000-000000000001'],
      publishedAt: new Date(NOW.getTime() - n * 3_600_000),
      promptVersions: ['writer@v1'],
      ...over,
    })
    .returning();
  return a!;
}

function scripted(answer: EntitiesResult) {
  let calls = 0;
  const provider: LlmProvider = {
    name: 'replay',
    async generate(request): Promise<LlmResponse> {
      expect(request.system).toBe(entitiesV1.system);
      calls++;
      return {
        text: JSON.stringify(answer),
        stop: 'end',
        model: 'gemini-flash-lite-latest',
        usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0 },
      };
    },
  };
  const llm: Llm = { db, provider, providerName: 'gemini', now: () => NOW };
  return { llm, calls: () => calls };
}

const answer: EntitiesResult = {
  entities: [
    { name: 'Palmetto Park Road', kind: 'street' },
    { name: 'Acme Paving LLC', kind: 'business' },
    { name: 'Jane Doe', kind: 'official' },
    { name: 'Boca Raton High School', kind: 'school' },
    { name: 'Boca Raton City Council', kind: 'agency' },
    // Not in the story as written: dropped.
    { name: 'Palmetto Park Rd.', kind: 'street' },
    { name: 'Glades Road', kind: 'street' },
    // The town itself: dropped.
    { name: 'Boca Raton', kind: 'agency' },
  ],
};

describe('matching keys', () => {
  it('ignores case, punctuation, street abbreviations and business forms only', () => {
    expect(entityKey('street', 'Palmetto Park Rd.')).toBe(
      entityKey('street', 'Palmetto Park Road'),
    );
    expect(entityKey('street', 'NW 2nd Ave')).toBe('northwest 2nd avenue');
    expect(entityKey('business', 'Acme Paving, LLC')).toBe('acme paving');
    expect(entityKey('agency', 'The City Council')).toBe('city council');
    // Kept apart when unsure: different words stay different entities.
    expect(entityKey('street', 'Palmetto Park Road')).not.toBe(
      entityKey('street', 'Palmetto Road'),
    );
    // Abbreviations expand only for streets ("St." in a school name stays).
    expect(entityKey('school', 'St. Andrew’s School')).toBe('st andrew s school');
  });

  it('keeps only names written verbatim in the story, once each, never the town', () => {
    const accepted = acceptEntities(answer, `Council approves paving\n${BODY}`, 'Boca Raton');
    expect(accepted.map((e) => e.name)).toEqual([
      'Palmetto Park Road',
      'Acme Paving LLC',
      'Jane Doe',
      'Boca Raton High School',
      'Boca Raton City Council',
    ]);
  });
});

describe('extraction', () => {
  it('links published stories to entities, matching later mentions to the same entity', async () => {
    const first = await story();
    const second = await story({ bodyMd: `${BODY} Palmetto Park Rd. reopens in December.` });
    const { llm, calls } = scripted(answer);
    const report = await extractEntitiesForTown(db, llm, townId, { now: NOW });
    expect(report).toMatchObject({ articles: 2, linked: 10, capReached: false });
    expect(calls()).toBe(2);

    const road = (await db.select().from(entities)).find((e) => e.kind === 'street')!;
    expect(road).toMatchObject({ name: 'Palmetto Park Road', slug: 'palmetto-park-road' });
    const links = await db
      .select()
      .from(articleEntities)
      .where(eq(articleEntities.entityId, road.id));
    expect(links.map((l) => l.articleId).sort()).toEqual([first.id, second.id].sort());

    // Each story is indexed once.
    expect(await extractEntitiesForTown(db, llm, townId, { now: NOW })).toMatchObject({
      articles: 0,
    });
  });

  it('skips code-built items and drafts, and gives no official a page from a Tier 3 story', async () => {
    await story({ promptVersions: ['template'], kind: 'roundup' });
    await story({ status: 'in_review', publishedAt: null });
    await story({ tier: 3 });
    const { llm, calls } = scripted(answer);
    const report = await extractEntitiesForTown(db, llm, townId, { now: NOW });
    expect(report).toMatchObject({ articles: 1, skipped: 1 });
    expect(calls()).toBe(1);
    const kinds = (await db.select().from(entities)).map((e) => e.kind);
    expect(kinds).not.toContain('official');
    expect(kinds).toContain('street');
  });
});

describe('related coverage', () => {
  it('puts linked stories first, then the most shared entities, published only', async () => {
    const base = await story();
    const sharesTwo = await story();
    const sharesOne = await story({ bodyMd: 'Palmetto Park Road reopens.' });
    const linked = await story({ bodyMd: 'Unrelated text.', headline: 'Follow-up' });
    const draft = await story({ status: 'in_review', publishedAt: null });
    const { llm } = scripted(answer);
    await extractEntitiesForTown(db, llm, townId, { now: NOW });
    // The draft shares entities too, but is never listed.
    const [road] = (await db.select().from(entities)).filter((e) => e.kind === 'street');
    await db
      .insert(articleEntities)
      .values({ articleId: draft.id, entityId: road!.id, mention: 'x' });
    await db
      .insert(articleLinks)
      .values({ fromArticleId: linked.id, toArticleId: base.id, kind: 'related' });

    expect(await relatedArticleIds(db, base.id)).toEqual([linked.id, sharesTwo.id, sharesOne.id]);
  });
});
