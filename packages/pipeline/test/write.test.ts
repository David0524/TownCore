import { fileURLToPath } from 'node:url';
import { loadTowns, type SourceKind } from '@towncore/config';
import {
  aiUsage,
  articles,
  eq,
  images,
  getTownBySlug,
  records,
  sources,
  staff,
  storyCandidates,
  syncTowns,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { factcheckV1, writerV1, type FactcheckResult, type WriterDraft } from '@towncore/prompts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Llm, LlmProvider, LlmResponse } from '../src/llm';
import { publishArticle, slugify, type Reviewer } from '../src/publish';
import { writeCandidate } from '../src/write';
import { classification } from './helpers';

const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));
const NOW = new Date('2026-10-17T15:00:00Z');
const TEXT =
  'The Boca Raton City Council voted 4-1 on Tuesday to approve a $2,500,000 contract with Acme Paving to resurface Palmetto Park Road. Work begins Nov. 2 and is expected to take six weeks, the city said.';

let db: Db;
let drop: () => Promise<void>;
let townId: string;
const sourceIds: Partial<Record<SourceKind, string>> = {};

const draft = (over: Partial<WriterDraft> = {}): WriterDraft => ({
  headline: 'Council approves paving contract for Palmetto Park Road',
  dek: 'The work begins Nov. 2.',
  body_md:
    'The Boca Raton City Council voted 4-1 on Tuesday to approve a $2,500,000 contract with Acme Paving to resurface Palmetto Park Road.',
  beat: 'government',
  source_record_ids: [],
  claims: [],
  ...over,
});
const goodCheck = (recordId: string): FactcheckResult => ({
  claims: [
    { claim: 'vote', record_id: recordId, quote: 'voted 4-1 on Tuesday', supported: true },
    {
      claim: 'contract',
      record_id: recordId,
      quote: 'a $2,500,000 contract with Acme Paving',
      supported: true,
    },
  ],
  wrong_town_risk: false,
  wrong_town_reason: null,
});

/** Scripted answers per prompt; records every request's input. */
function scripted(answers: { writer?: unknown[]; factcheck?: unknown[]; refuse?: 'writer' }) {
  const inputs: { prompt: string; input: string }[] = [];
  const queues = { writer: [...(answers.writer ?? [])], factcheck: [...(answers.factcheck ?? [])] };
  const provider: LlmProvider = {
    name: 'replay',
    async generate(request): Promise<LlmResponse> {
      const prompt =
        request.system === writerV1.system
          ? 'writer'
          : request.system === factcheckV1.system
            ? 'factcheck'
            : 'other';
      inputs.push({ prompt, input: request.input });
      const usage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0 };
      if (answers.refuse === prompt) return { text: '', stop: 'refusal', model: 'm', usage };
      const queue = queues[prompt as 'writer' | 'factcheck'];
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return { text: JSON.stringify(next), stop: 'end', model: 'gemini-flash-latest', usage };
    },
  };
  const llm: Llm = { db, provider, providerName: 'gemini', now: () => NOW };
  return { llm, inputs };
}

async function storyCandidate(
  text = TEXT,
  over: Partial<typeof storyCandidates.$inferInsert> = {},
) {
  const [record] = await db
    .insert(records)
    .values({
      sourceId: sourceIds.city_news!,
      townId,
      externalId: `r-${Math.random()}`,
      type: 'release',
      title: 'Council approves paving contract',
      text,
      contentHash: 'h',
      occurredAt: NOW,
    })
    .returning();
  const [candidate] = await db
    .insert(storyCandidates)
    .values({
      townId,
      kind: 'story',
      key: `record:${record!.id}`,
      title: record!.title,
      beat: 'government',
      recordIds: [record!.id],
      proposedTier: 2,
      classification: classification(),
      tierReasons: ['model proposed Tier 2'],
      status: 'accepted',
      acceptedAt: NOW,
      ...over,
    })
    .returning();
  return { candidate: candidate!, recordId: record!.id };
}

const article = async (id: string) =>
  (await db.select().from(articles).where(eq(articles.id, id)))[0]!;

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  const loaded = loadTowns(townsDir).filter((t) => t.config.slug === 'boca-raton');
  await syncTowns(
    db,
    loaded.map((t) => ({ ...t, config: { ...t.config, sources: [] } })),
  );
  townId = (await getTownBySlug(db, 'boca-raton'))!.id;
  for (const kind of ['city_news', 'business_filings', 'weather'] as const) {
    const [s] = await db
      .insert(sources)
      .values({ townId, kind, platform: 'test', adapter: 'test', key: kind })
      .returning();
    sourceIds[kind] = s!.id;
  }
});
afterAll(async () => drop());
beforeEach(async () => {
  await db.update(storyCandidates).set({ articleId: null });
  await db.delete(articles);
  await db.delete(storyCandidates);
  await db.delete(aiUsage);
  await db.update(towns).set({ status: 'draft' }).where(eq(towns.id, townId));
});

describe('writeCandidate: stories', () => {
  it('publishes a Tier 2 story that passes fact-check', async () => {
    const { candidate, recordId } = await storyCandidate();
    const { llm, inputs } = scripted({
      writer: [draft({ source_record_ids: [recordId] })],
      factcheck: [goodCheck(recordId)],
    });
    const outcome = await writeCandidate(db, candidate.id, { llm, now: NOW, random: () => 0.5 });
    expect(outcome.status).toBe('published');
    const a = await article((outcome as { articleId: string }).articleId);
    expect(a).toMatchObject({
      slug: 'council-approves-paving-contract-for-palmetto-park-road',
      status: 'published',
      tier: 2,
      byline: 'Boca Town Square Newsroom (AI-assisted)',
      sourceRecordIds: [recordId],
      promptVersions: ['writer@v1', 'factcheck@v1'],
      reviewReason: null,
      candidateId: candidate.id,
    });
    expect(a.publishedAt).toEqual(NOW);
    expect(a.factcheck).toMatchObject({ method: 'model+code', score: 1, decision: 'pass' });
    // Fact-check never sees the writer's prompt: only the draft and the records.
    const fc = inputs.find((i) => i.prompt === 'factcheck')!.input;
    expect(fc).toContain('=== Draft');
    expect(fc).not.toContain('Beat: government. Kind: story.');
    const [c] = await db.select().from(storyCandidates).where(eq(storyCandidates.id, candidate.id));
    expect(c).toMatchObject({ status: 'written', articleId: a.id });
  });

  it('sends a recap that used a machine transcript to review, even when it passes', async () => {
    const { candidate, recordId } = await storyCandidate();
    const [transcript] = await db
      .insert(records)
      .values({
        sourceId: sourceIds.city_news!,
        townId,
        externalId: `transcript-${Math.random()}`,
        type: 'transcript',
        title: 'Transcript: Town Council Meeting',
        text: 'Machine-generated captions. THE COUNCIL VOTED 4-1.',
        contentHash: 't',
        occurredAt: NOW,
      })
      .returning();
    await db
      .update(storyCandidates)
      .set({ recordIds: [recordId, transcript!.id] })
      .where(eq(storyCandidates.id, candidate.id));
    const { llm, inputs } = scripted({
      writer: [draft({ source_record_ids: [recordId] })],
      factcheck: [goodCheck(recordId)],
    });
    const outcome = await writeCandidate(db, candidate.id, { llm, now: NOW, random: () => 0.5 });
    expect(outcome).toMatchObject({ status: 'in_review', reason: 'transcript' });
    expect((await article((outcome as { articleId: string }).articleId)).reviewReason).toBe(
      'transcript',
    );
    // The writer saw the transcript alongside the release.
    expect(inputs.find((i) => i.prompt === 'writer')!.input).toContain('THE COUNCIL VOTED 4-1.');
  });

  it('samples 10% of passing Tier 2 stories into review before publishing', async () => {
    const { candidate, recordId } = await storyCandidate();
    const { llm } = scripted({
      writer: [draft({ source_record_ids: [recordId] })],
      factcheck: [goodCheck(recordId)],
    });
    const outcome = await writeCandidate(db, candidate.id, { llm, now: NOW, random: () => 0.05 });
    expect(outcome).toMatchObject({ status: 'in_review', reason: 'sample' });
    expect((await article((outcome as { articleId: string }).articleId)).publishedAt).toBeNull();
  });

  it('gives the writer one retry without the unsupported claims, then sends it to review', async () => {
    const { candidate, recordId } = await storyCandidate();
    const bad = draft({
      source_record_ids: [recordId],
      body_md: `${draft().body_md} The project will cost taxpayers $3 million.`,
    });
    const { llm, inputs } = scripted({ writer: [bad], factcheck: [goodCheck(recordId)] });
    const outcome = await writeCandidate(db, candidate.id, { llm, now: NOW, random: () => 0.5 });
    expect(outcome).toMatchObject({ status: 'in_review', reason: 'factcheck' });
    const writes = inputs.filter((i) => i.prompt === 'writer');
    expect(writes).toHaveLength(2);
    expect(writes[1]!.input).toContain('Remove these claims');
    expect(writes[1]!.input).toContain('the number 3 (number not found in any cited record)');
  });

  it('publishes when the retry fixes it', async () => {
    const { candidate, recordId } = await storyCandidate();
    const bad = draft({
      source_record_ids: [recordId],
      body_md: `${draft().body_md} It costs $3 million.`,
    });
    const { llm } = scripted({
      writer: [bad, draft({ source_record_ids: [recordId] })],
      factcheck: [goodCheck(recordId)],
    });
    expect(
      await writeCandidate(db, candidate.id, { llm, now: NOW, random: () => 0.5 }),
    ).toMatchObject({ status: 'published' });
  });

  it('Tier 3 always goes to review', async () => {
    const { candidate, recordId } = await storyCandidate(TEXT, { proposedTier: 3 });
    const { llm } = scripted({
      writer: [draft({ source_record_ids: [recordId] })],
      factcheck: [goodCheck(recordId)],
    });
    expect(
      await writeCandidate(db, candidate.id, { llm, now: NOW, random: () => 0.9 }),
    ).toMatchObject({ status: 'in_review', reason: 'tier3' });
  });

  it('blocks a draft that names a minor, even if fact-check passes (Rule 5)', async () => {
    const text = `${TEXT} Police said Jordan Smith, 16, was cited.`;
    const { candidate, recordId } = await storyCandidate(text);
    const { llm } = scripted({
      writer: [draft({ source_record_ids: [recordId] })],
      factcheck: [goodCheck(recordId)],
    });
    const outcome = await writeCandidate(db, candidate.id, { llm, now: NOW, random: () => 0.9 });
    expect(outcome.status).toBe('blocked');
    const a = await article((outcome as { articleId: string }).articleId);
    expect(a).toMatchObject({ tier: 4, status: 'blocked', publishedAt: null });
  });

  it('skips a candidate the writer refuses, and waits when there is no model', async () => {
    const { candidate } = await storyCandidate();
    const { llm } = scripted({ refuse: 'writer' });
    expect(await writeCandidate(db, candidate.id, { llm, now: NOW })).toMatchObject({
      status: 'skipped',
    });
    const second = await storyCandidate();
    expect(await writeCandidate(db, second.candidate.id, { now: NOW })).toMatchObject({
      status: 'waiting',
    });
    const [c] = await db
      .select()
      .from(storyCandidates)
      .where(eq(storyCandidates.id, second.candidate.id));
    expect(c?.status).toBe('accepted');
  });
});

describe('writeCandidate: templated items', () => {
  it('publishes a roundup built from records, with no model call', async () => {
    const [filing] = await db
      .insert(records)
      .values({
        sourceId: sourceIds.business_filings!,
        townId,
        externalId: 'filing:1',
        type: 'new-filing',
        title: 'TEENS ACADEMY LLC',
        text: 'Florida limited liability company, document number L1, filed 10/06/2026. Principal address: 1 Main St, BOCA RATON, FL 33431.',
        contentHash: 'h',
        occurredAt: new Date('2026-10-06T00:00:00Z'),
        raw: { zip: '33431' },
      })
      .returning();
    const [candidate] = await db
      .insert(storyCandidates)
      .values({
        townId,
        kind: 'roundup',
        key: 'roundup:new-businesses:2026-10-05',
        beat: 'business',
        recordIds: [filing!.id],
        proposedTier: 1,
        status: 'accepted',
      })
      .returning();
    const outcome = await writeCandidate(db, candidate!.id, { now: NOW });
    expect(outcome.status).toBe('published');
    const a = await article((outcome as { articleId: string }).articleId);
    expect(a).toMatchObject({
      headline: 'New businesses registered with a Boca Raton address, Oct. 5–Oct. 11',
      tier: 1,
      promptVersions: ['template'],
      sourceRecordIds: [filing!.id],
    });
    expect(a.bodyMd).toContain('TEENS ACADEMY LLC');
    expect(a.bodyMd).not.toContain('1 Main St');
    // One record is too little for a chart: the router falls back to the typographic card.
    const [image] = await db.select().from(images).where(eq(images.articleId, a.id));
    expect(image).toMatchObject({
      kind: 'typographic-card',
      license: 'own-work',
      aiGenerated: false,
    });
    expect(image!.alt).toContain(a.headline);
  });

  it('gives a roundup over several days a data graphic built from its records', async () => {
    const filings = await db
      .insert(records)
      .values(
        ['2026-10-06', '2026-10-06', '2026-10-07', '2026-10-09', '2026-10-09'].map((day, i) => ({
          sourceId: sourceIds.business_filings!,
          townId,
          externalId: `filing:chart:${i}`,
          type: 'new-filing',
          title: `SAMPLE ${i} LLC`,
          text: `Florida limited liability company, filed ${day}.`,
          contentHash: `c${i}`,
          occurredAt: new Date(`${day}T15:00:00Z`),
          raw: {},
        })),
      )
      .returning();
    const [candidate] = await db
      .insert(storyCandidates)
      .values({
        townId,
        kind: 'roundup',
        key: 'roundup:new-businesses:2026-10-12',
        beat: 'business',
        recordIds: filings.map((f) => f.id),
        proposedTier: 1,
        status: 'accepted',
      })
      .returning();
    const outcome = await writeCandidate(db, candidate!.id, { now: NOW });
    const articleId = (outcome as { articleId: string }).articleId;
    const [image] = await db.select().from(images).where(eq(images.articleId, articleId));
    expect(image?.kind).toBe('data-graphic');
    expect(image?.spec).toMatchObject({ type: 'daily-counts', total: 5 });
    expect(image?.alt).toMatch(/^Bar chart of new business filings by day, Oct\. 6 to Oct\. 9/);
  });
});

describe('publishing with a reviewer', () => {
  const john = async (): Promise<Reviewer> => {
    const [row] = await db
      .insert(staff)
      .values({
        email: `john-${Math.random()}@example.com`,
        name: 'John',
        role: 'reviewer',
        placeholder: true,
      })
      .returning();
    return { id: row!.id, name: row!.name, placeholder: true };
  };

  it('marks the story reviewed without naming the reviewer, on draft and live towns', async () => {
    const { candidate, recordId } = await storyCandidate(TEXT, { proposedTier: 3 });
    const { llm } = scripted({
      writer: [draft({ source_record_ids: [recordId] })],
      factcheck: [goodCheck(recordId)],
    });
    const { articleId } = (await writeCandidate(db, candidate.id, { llm, now: NOW })) as {
      articleId: string;
    };
    const reviewer = await john();

    await db.update(towns).set({ status: 'live' }).where(eq(towns.id, townId));
    await publishArticle(db, articleId, { reviewer, now: NOW });
    expect(await article(articleId)).toMatchObject({
      status: 'published',
      byline: 'Boca Town Square Newsroom (AI-assisted). Reviewed by an editor',
      reviewerId: reviewer.id,
      reviewReason: null,
    });
    await db.update(towns).set({ status: 'draft' }).where(eq(towns.id, townId));
  });

  it('slugify', () => {
    expect(slugify('Café & Bar opens on A1A — “finally”')).toBe(
      'cafe-and-bar-opens-on-a1a-finally',
    );
  });
});
