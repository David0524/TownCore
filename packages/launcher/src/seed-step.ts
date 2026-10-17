import { readFileSync } from 'node:fs';
import { parseTownConfig } from '@towncore/config';
import { planPrices, seedDirectory } from '@towncore/directory';
import {
  and,
  articles,
  desc,
  eq,
  inArray,
  mailDomains,
  storyCandidates,
  towns,
  type Db,
} from '@towncore/db';
import { runStoryFinder, writeCandidate, type Llm } from '@towncore/pipeline';
import type { NamesDetail } from './names-step';
import { launchLlmTown } from './sources-step';

// Launch steps 6 and 7 (CLAUDE.md §10; docs/plans/M7.md §2). Seeding runs the normal pipeline on
// the draft town: the story finder (roundups and alerts built in code; stories classified when a
// model is configured), then the writer and fact-check for what it accepted. Nothing publishes
// publicly: the town is a draft (noindex, robots disallow) until an admin approves it. Directory
// listings come from state license data where an adapter exists (Florida).
// Provisioning is a dry run: it lists what would be created and the commands that need a
// person's approval (Rule 10). Nothing is bought, sent or deployed.

/** Most candidates written while seeding (the town's daily budget still applies). */
export const SEED_WRITE_LIMIT = 15;

export type SeedDetail = {
  finder: { roundups: number; candidates: number; accepted: number; pending: number };
  written: Array<{ headline: string; status: string; slug: string | null; tier: number | null }>;
  directory: { listings: number } | { skipped: string };
  guides: { topics: number; note: string };
  samples: Array<{ headline: string; url: string; status: string }>;
};

async function draftTown(db: Db, names: NamesDetail) {
  if (!names.picked) throw new Error('Step 2 has no picked name.');
  const config = parseTownConfig(
    readFileSync(names.picked.townFile, 'utf8'),
    names.picked.townFile,
  );
  const [town] = await db.select().from(towns).where(eq(towns.slug, config.slug));
  if (!town) throw new Error(`${config.slug} isn't in the database; run steps 3–5 first.`);
  return { town, config };
}

export async function seedStep(input: {
  db: Db;
  llm?: Llm;
  names: NamesDetail;
  now: Date;
  launchStartedAt: Date;
}): Promise<{ detail: SeedDetail }> {
  const { db, now } = input;
  const { town, config } = await draftTown(db, input.names);
  // Seeding shares the launch's AI budget (D-M7-11): refuse up front once it's spent.
  if (input.llm) await launchLlmTown(db, town, input.launchStartedAt);
  const report = await runStoryFinder(db, town.id, {
    ...(input.llm ? { llm: input.llm } : {}),
    now,
  });
  const accepted = await db
    .select({ id: storyCandidates.id })
    .from(storyCandidates)
    .where(and(eq(storyCandidates.townId, town.id), eq(storyCandidates.status, 'accepted')))
    .limit(SEED_WRITE_LIMIT);
  for (const c of accepted)
    await writeCandidate(db, c.id, { ...(input.llm ? { llm: input.llm } : {}), now });

  const rows = await db
    .select({
      headline: articles.headline,
      status: articles.status,
      slug: articles.slug,
      tier: articles.tier,
      kind: articles.kind,
    })
    .from(articles)
    .where(eq(articles.townId, town.id))
    .orderBy(desc(articles.createdAt));
  let directory: SeedDetail['directory'];
  if (town.state === 'FL') {
    const seeded = await seedDirectory(db, town.id, now);
    directory = { listings: seeded.active ?? 0 };
  } else
    directory = {
      skipped: `No state license adapter for ${town.state} yet; the directory starts empty.`,
    };

  const shown = rows
    .filter((r) => r.status === 'published' || r.status === 'in_review')
    .slice(0, 5);
  return {
    detail: {
      finder: {
        roundups: report.roundups.length,
        candidates: report.candidates,
        accepted: report.accepted,
        pending: report.pending,
      },
      written: rows.map((r) => ({
        headline: r.headline,
        status: r.status,
        slug: r.slug,
        tier: r.tier,
      })),
      directory,
      guides: {
        topics: config.guides.length,
        note: config.guides.length
          ? `${config.guides.length} guide topics mapped; guides are written by the story finder and reviewed before the first 30 publish (D-M4-2).`
          : 'No guide topics mapped yet: map the network guide topics to official pages in the town YAML (guides:), verified live (D-M4-2).',
      },
      samples: shown.map((r) => ({
        headline: r.headline,
        url: `https://${config.domain}${r.kind === 'guide' ? '/guides/' : '/news/'}${r.slug}`,
        status: r.status,
      })),
    },
  };
}

export type ProvisionDetail = {
  stripe: Array<{ product: string; amountUsd: number; action: string }>;
  mail: { status: string };
  newsletter: string;
  approvals: Array<{ what: string; command: string }>;
};

export async function provisionStep(input: {
  db: Db;
  names: NamesDetail;
}): Promise<{ detail: ProvisionDetail }> {
  const { db } = input;
  const { town, config } = await draftTown(db, input.names);
  const plan = await planPrices(db, [town.slug]);
  const [mail] = await db
    .select({ status: mailDomains.status })
    .from(mailDomains)
    .where(inArray(mailDomains.name, [config.domain]));
  const purchase = input.names.purchase;
  const bought = purchase && 'orderId' in purchase && purchase.status === 'completed';
  return {
    detail: {
      stripe: plan.map((p) => ({
        product: p.product,
        amountUsd: p.amountCents / 100,
        action: p.action,
      })),
      mail: { status: mail?.status ?? 'not onboarded' },
      newsletter: 'off: an admin switches it to test, then live after 3 test issues (D-M5-2)',
      approvals: [
        ...(bought
          ? []
          : [
              {
                what: `Buy ${config.domain} (Rule 10; step 2b then onboards its mail under the same approval, so warm-up starts at once)`,
                command: `pnpm launch "${town.name}, ${town.state}" --resume --approve-spend`,
              },
            ]),
        {
          what: 'Stripe test prices for this town',
          command: `pnpm directory:stripe sync --town ${town.slug} --execute`,
        },
        {
          what: 'Attach the domain to the Vercel web project (production deploy, Rule 10)',
          command: `Vercel dashboard → Project → Domains → add ${config.domain} and www.${config.domain}`,
        },
      ],
    },
  };
}
