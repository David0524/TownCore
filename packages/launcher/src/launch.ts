import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { launchStepLabels, launchSteps, type LaunchStep } from '@towncore/config';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  launchStepRecords,
  launches,
  sql,
  townCandidates,
  type Db,
} from '@towncore/db';
import type { ResolvedTown } from './resolve';
import { DEFAULT_TOWNS_DIR, namesStep, type NameDeps, type NamesDetail } from './names-step';

// `pnpm launch "Delray Beach, FL"` (CLAUDE.md §10; docs/plans/M7.md §2). A launch starts only
// from an approved town (§10a), is a dry run unless the operator approves spending, and records
// every step so a stopped run resumes. Steps not built yet stop the run with that reason; they
// arrive in later M7 PRs.

export const DEFAULT_LAUNCH_DIR = fileURLToPath(new URL('../../../docs/launches', import.meta.url));

export class LaunchRefused extends Error {}

export type LaunchOptions = {
  /** "Delray Beach, FL" */
  town: string;
  domain?: string;
  approveSpend?: boolean;
  resume?: boolean;
  /** Step 2: the town as readers say it in a site name ("Delray"); default the full name. */
  shortName?: string;
  /** Step 2: a well-known local nickname, for "The {Nickname} Post". */
  nickname?: string;
  /** Step 2: local outlets, current or defunct, the name must not resemble. */
  outlets?: string[];
  /** Step 2: the proposal the owner picked (1–3). */
  pick?: number;
};

export type LaunchDeps = {
  db: Db;
  resolve: (town: string) => Promise<ResolvedTown>;
  /** Step 2: names, domains and the registrar. Without it, step 2 stops the run. */
  names?: NameDeps;
  launchDir?: string;
  townsDir?: string;
  now?: () => Date;
};

type StepRun = (ctx: {
  deps: LaunchDeps;
  launch: typeof launches.$inferSelect;
  done: Partial<Record<LaunchStep, unknown>>;
}) => Promise<{ detail: unknown; files?: string[]; waiting?: string }>;

/** The steps built so far. Each returns what it found; files it wrote are listed for the operator. */
const STEPS: Partial<Record<LaunchStep, StepRun>> = {
  async resolve({ deps, launch }) {
    const town = await deps.resolve(`${launch.name}, ${launch.state}`);
    const dir = join(deps.launchDir ?? DEFAULT_LAUNCH_DIR, town.slug);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${town.slug}.draft.yaml`);
    writeFileSync(path, draftTownYaml(town, launch.options as LaunchOptions));
    return { detail: town, files: [path] };
  },
  async names({ deps, launch, done }) {
    if (!deps.names) throw new Error('No domain registrar configured for this run.');
    return namesStep({
      deps: deps.names,
      db: deps.db,
      town: done.resolve as ResolvedTown,
      options: launch.options as LaunchOptions,
      previous: done.names as NamesDetail | undefined,
      dirs: {
        launch: deps.launchDir ?? DEFAULT_LAUNCH_DIR,
        towns: deps.townsDir ?? DEFAULT_TOWNS_DIR,
      },
    });
  },
};

export type LaunchResult = {
  launch: typeof launches.$inferSelect;
  steps: Array<typeof launchStepRecords.$inferSelect>;
  files: string[];
};

/** Finds the approved candidate for "Name, ST", or explains why the launch can't start. */
export async function approvedCandidate(db: Db, town: string) {
  const [name, state] = town.split(',').map((s) => s.trim());
  if (!name || !state || !/^[A-Za-z]{2}$/.test(state))
    throw new LaunchRefused(`Give the town as "Name, ST" (got "${town}").`);
  const [candidate] = await db
    .select()
    .from(townCandidates)
    .where(
      and(
        eq(townCandidates.state, state.toUpperCase()),
        sql`lower(${townCandidates.name}) = ${name.toLowerCase()}`,
      ),
    );
  if (!candidate)
    throw new LaunchRefused(
      `${name}, ${state.toUpperCase()} hasn't been ranked. Run pnpm towns:rank ${state.toUpperCase()} first.`,
    );
  if (candidate.status !== 'approved')
    throw new LaunchRefused(
      `${candidate.name}, ${candidate.state} is ${candidate.status}, not approved. An admin approves towns in Admin → Launches (CLAUDE.md §10a).`,
    );
  return candidate;
}

export async function runLaunch(deps: LaunchDeps, opts: LaunchOptions): Promise<LaunchResult> {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();
  const candidate = await approvedCandidate(db, opts.town);
  const [open] = await db
    .select()
    .from(launches)
    .where(
      and(
        eq(launches.geoid, candidate.geoid),
        inArray(launches.status, ['running', 'stopped', 'failed']),
      ),
    )
    .orderBy(desc(launches.createdAt))
    .limit(1);
  if (open && !opts.resume)
    throw new LaunchRefused(
      `${candidate.name} already has an unfinished launch (started ${open.createdAt.toISOString().slice(0, 16)}). Pass --resume to continue it.`,
    );

  let launch = open;
  if (!launch) {
    [launch] = await db
      .insert(launches)
      .values({
        candidateId: candidate.id,
        geoid: candidate.geoid,
        slug: candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: candidate.name,
        state: candidate.state,
        dryRun: !opts.approveSpend,
        options: opts,
        startedBy: safeUser(),
      })
      .returning();
    await db
      .insert(launchStepRecords)
      .values(launchSteps.map((step) => ({ launchId: launch!.id, step })));
  } else {
    [launch] = await db
      .update(launches)
      .set({
        status: 'running',
        stoppedReason: null,
        dryRun: !opts.approveSpend,
        // Flags given on resume (a pick, an outlet) join the ones the run started with.
        options: { ...(launch.options as LaunchOptions), ...definedOnly(opts) },
        updatedAt: now(),
      })
      .where(eq(launches.id, launch.id))
      .returning();
  }

  const files: string[] = [];
  const records = await stepRecords(db, launch!.id);
  const done: Partial<Record<LaunchStep, unknown>> = Object.fromEntries(
    records.filter((r) => r.status === 'done').map((r) => [r.step, r.detail]),
  );
  // Step 2 runs again when the owner picks again or approves spending after a dry-run pick.
  const names = done.names as NamesDetail | undefined;
  if (
    names?.picked &&
    ((opts.pick &&
      names.proposals.filter((p) => !p.blocked.length)[opts.pick - 1]?.domain !==
        names.picked.domain) ||
      (opts.approveSpend && names.purchase?.status === 'not bought'))
  ) {
    delete done.names;
    await db
      .update(launchStepRecords)
      .set({ status: 'pending' })
      .where(and(eq(launchStepRecords.launchId, launch!.id), eq(launchStepRecords.step, 'names')));
    records.find((r) => r.step === 'names')!.detail = names;
  }
  for (const step of launchSteps) {
    if (step in done) continue;
    const run = STEPS[step];
    if (!run) {
      [launch] = await db
        .update(launches)
        .set({
          status: 'stopped',
          stoppedReason: `${launchStepLabels[step]} isn't built yet (later M7 PRs).`,
          updatedAt: now(),
        })
        .where(eq(launches.id, launch!.id))
        .returning();
      break;
    }
    await db
      .update(launchStepRecords)
      .set({ startedAt: now(), attempts: sql`${launchStepRecords.attempts} + 1`, error: null })
      .where(and(eq(launchStepRecords.launchId, launch!.id), eq(launchStepRecords.step, step)));
    try {
      const pending = records.find((r) => r.step === step)?.detail;
      const out = await run({
        deps,
        launch: launch!,
        done: { ...done, [step]: pending ?? undefined },
      });
      if (out.waiting) {
        // The step needs a person (the owner picks a name): keep what it found, stop the run.
        await db
          .update(launchStepRecords)
          .set({ detail: out.detail, finishedAt: now() })
          .where(and(eq(launchStepRecords.launchId, launch!.id), eq(launchStepRecords.step, step)));
        files.push(...(out.files ?? []));
        [launch] = await db
          .update(launches)
          .set({ status: 'stopped', stoppedReason: out.waiting, updatedAt: now() })
          .where(eq(launches.id, launch!.id))
          .returning();
        break;
      }
      done[step] = out.detail;
      files.push(...(out.files ?? []));
      await db
        .update(launchStepRecords)
        .set({ status: 'done', detail: out.detail, finishedAt: now() })
        .where(and(eq(launchStepRecords.launchId, launch!.id), eq(launchStepRecords.step, step)));
      if (step === 'resolve') {
        const slug = (out.detail as ResolvedTown).slug;
        [launch] = await db
          .update(launches)
          .set({ slug, updatedAt: now() })
          .where(eq(launches.id, launch!.id))
          .returning();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(launchStepRecords)
        .set({ status: 'failed', error: message, finishedAt: now() })
        .where(and(eq(launchStepRecords.launchId, launch!.id), eq(launchStepRecords.step, step)));
      [launch] = await db
        .update(launches)
        .set({
          status: 'failed',
          stoppedReason: `${launchStepLabels[step]}: ${message}`,
          updatedAt: now(),
        })
        .where(eq(launches.id, launch!.id))
        .returning();
      break;
    }
  }
  return { launch: launch!, steps: await stepRecords(db, launch!.id), files };
}

async function stepRecords(db: Db, launchId: string) {
  const rows = await db
    .select()
    .from(launchStepRecords)
    .where(eq(launchStepRecords.launchId, launchId))
    .orderBy(asc(launchStepRecords.step));
  return launchSteps.map((s) => rows.find((r) => r.step === s)!).filter(Boolean);
}

function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function safeUser(): string | null {
  try {
    return userInfo().username;
  } catch {
    return null;
  }
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * The town's config as far as step 1 knows it. It lives beside the launch report until a name and
 * domain are chosen (step 2); only then does it move into towns/, where the loader validates it.
 */
export function draftTownYaml(
  town: ResolvedTown,
  opts: LaunchOptions,
  chosen?: { siteName: string; domain: string },
): string {
  const header = chosen
    ? `# ${chosen.siteName}, from pnpm launch (CLAUDE.md §10). Schema: packages/config/src/town.ts.
# Draft town: sources are added as step 3 verifies them; it goes live only from Admin → Launches.`
    : `# DRAFT from pnpm launch, step 1 (resolve). Moves to towns/${town.state.toLowerCase()}/${town.slug}.yaml once
# a name and domain are chosen (step 2). Schema: packages/config/src/town.ts (CLAUDE.md §10).`;
  const site = chosen ? q(chosen.siteName) : 'TBD # step 2: the name the owner picks';
  const domain = chosen
    ? chosen.domain
    : `${opts.domain ?? 'TBD'} # step 2${opts.domain ? ' (from --domain; checked and bought only with --approve-spend)' : ''}`;
  return `${header}
slug: ${town.slug}
name: ${q(town.name)}
state: ${town.state}
census_id: ${q(town.censusId)} # Census place GEOID (${town.censusName}, 2026 Gazetteer)
county: ${q(town.county)}
timezone: ${town.timezone}
site_name: ${site}
domain: ${domain}
extra_domains: []
tier: ${town.tier} # ${town.population2025.toLocaleString('en-US')} people (Vintage 2025 estimate)
newsletter_send_time: '06:30'
same_name_elsewhere: [${town.sameNameElsewhere.map(q).join(', ')}] # wrong-town checks
agencies:
${town.agencies.map((a) => `  - ${q(a)}`).join('\n')}
  # step 3 adds the police and fire agencies it finds
sources:
  # step 3 discovers the rest; every URL is fetched and matched to an adapter before it's added
  - kind: weather
    platform: nws
    zone: ${town.nws.zone} # NWS ${town.nws.office}, from api.weather.gov/points
    point: '${town.nws.point}'
pricing: { sponsored_slot_usd: 199, enhanced_usd: 39 } # Boca's prices until the owner sets this town's
`;
}
