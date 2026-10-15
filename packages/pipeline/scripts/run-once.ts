// pnpm pipeline:once <town-slug>: run the story finder for one town, then write every accepted
// candidate, right now, with the configured model provider. Same code path as the worker's
// story-finder and writer jobs, without the queue. Prints what was written, skipped, sent to
// review or blocked, and the day's AI spend. In the cloud sandbox run with NODE_USE_ENV_PROXY=1.
import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { and, createDb, eq, isNull, storyCandidates, towns } from '@towncore/db';
import { runStoryFinder } from '../src/finder';
import { providerFromEnv, todaysUsage, type Llm } from '../src/llm';
import { writeCandidate, type WriteOutcome } from '../src/write';

loadDotEnv();
const slug = process.argv[2];
if (!slug) throw new Error('Usage: pnpm pipeline:once <town-slug>');
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
try {
  const [town] = await db.select().from(towns).where(eq(towns.slug, slug));
  if (!town) throw new Error(`Unknown town ${slug}; run pnpm towns:sync first`);
  const { name, provider } = providerFromEnv();
  const llm: Llm = { db, provider, providerName: name };
  console.log(`Story finder for ${slug} with ${name}…`);
  // A provider failure stops the finder, but roundups and templates it already accepted are
  // built in code, so the writer still runs for them.
  try {
    console.log(await runStoryFinder(db, town.id, { llm }));
  } catch (err) {
    console.log('Story finder stopped:', err instanceof Error ? err.message : err);
  }

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
    let outcome: WriteOutcome;
    try {
      outcome = await writeCandidate(db, candidate.id, { llm });
    } catch (err) {
      outcome = { status: 'waiting', reason: err instanceof Error ? err.message : String(err) };
    }
    tally[outcome.status] = (tally[outcome.status] ?? 0) + 1;
    console.log(candidate.id, outcome);
  }
  console.log('Writer:', tally);
  console.log('AI usage today:', await todaysUsage(db, town, new Date()));
} finally {
  await db.$client.end();
}
