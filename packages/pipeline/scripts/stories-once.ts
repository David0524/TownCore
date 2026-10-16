// pnpm stories:once <town-slug>: run the story finder for one town right now, then write every
// accepted, unwritten candidate, then index published stories for topic pages. Same code path as the worker's story-finder and writer jobs.
// Without a model provider, only code-built items (roundups, NWS alerts) are made; candidates
// that need classification stay pending. In the cloud sandbox run with NODE_USE_ENV_PROXY=1.
import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { and, createDb, eq, isNull, storyCandidates, towns } from '@towncore/db';
import { extractEntitiesForTown, runStoryFinder, writeCandidate } from '../src';
import { providerFromEnv, resolveProviderName, type Llm } from '../src/llm';

loadDotEnv();
const slug = process.argv[2];
if (!slug) throw new Error('usage: pnpm stories:once <town-slug>');
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
try {
  const [town] = await db.select().from(towns).where(eq(towns.slug, slug));
  if (!town) throw new Error(`unknown town: ${slug}`);
  const provider = resolveProviderName() ? providerFromEnv() : undefined;
  const llm: Llm | undefined = provider
    ? { db, provider: provider.provider, providerName: provider.name }
    : undefined;
  console.log(`model provider: ${provider?.name ?? 'none'}`);

  const report = await runStoryFinder(db, town.id, { llm });
  console.log('story finder:', report);

  const ready = await db
    .select({ id: storyCandidates.id })
    .from(storyCandidates)
    .where(
      and(
        eq(storyCandidates.townId, town.id),
        eq(storyCandidates.status, 'accepted'),
        isNull(storyCandidates.articleId),
      ),
    );
  const tally: Record<string, number> = {};
  for (const candidate of ready) {
    const outcome = await writeCandidate(db, candidate.id, { llm });
    tally[outcome.status] = (tally[outcome.status] ?? 0) + 1;
    console.log(`writer ${candidate.id}:`, outcome);
  }
  console.log('writer totals:', tally);
  if (llm) console.log('entities:', await extractEntitiesForTown(db, llm, town.id));
} finally {
  await db.$client.end();
}
