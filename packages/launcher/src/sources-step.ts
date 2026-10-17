import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultTheme,
  LAUNCH_AI_CAP_USD,
  parseTownConfig,
  type TownConfig,
  type TownSourceConfig,
} from '@towncore/config';
import type { Fetcher } from '@towncore/adapters';
import { aiUsage, and, eq, gte, sql, syncTowns, towns, type Db } from '@towncore/db';
import { callModel, type Llm, type LlmTown } from '@towncore/pipeline';
import { discoverV1 } from '@towncore/prompts';
import { stringify } from 'yaml';
import {
  parseSourceFlags,
  stateSources,
  verifiedSources,
  verifyUrl,
  type DiscoverDetail,
  type Finding,
} from './discover';
import { resemblesOutlet } from './names';
import type { NamesDetail } from './names-step';
import { measureReadiness, type ReadinessDetail } from './readiness';
import type { ResolvedTown } from './resolve';

// Launch steps 3–5 (CLAUDE.md §10): discover sources, write the verified ones into the town's
// config (with adapter requests for the rest), then measure readiness (Rule 7).

export type SourceStepDeps = {
  db: Db;
  fetcher: Fetcher;
  /** The model layer; discovery runs only if its provider can search the web (D-M7-2). */
  llm?: Llm;
  now: () => Date;
};

/** The draft town's model budget: the whole launch shares $25 (D-M7-11). */
export async function launchLlmTown(
  db: Db,
  town: { id: string; timezone: string },
  launchStartedAt: Date,
): Promise<LlmTown> {
  const [row] = await db
    .select({ cost: sql<string>`coalesce(sum(${aiUsage.estCostUsd}), 0)` })
    .from(aiUsage)
    .where(
      // A draft town's AI use is all launch work: discovery, readiness, seeding, the theme.
      and(eq(aiUsage.townId, town.id), gte(aiUsage.createdAt, launchStartedAt)),
    );
  const spent = Number(row?.cost ?? 0);
  if (spent >= LAUNCH_AI_CAP_USD)
    throw new Error(`This launch has spent its $${LAUNCH_AI_CAP_USD} of AI (D-M7-11).`);
  // callModel's daily cap counts today's spend for the town, which is this launch's spend.
  return {
    id: town.id,
    timezone: town.timezone,
    aiDailyCapUsd: LAUNCH_AI_CAP_USD,
    aiDailyCallCap: 400,
  };
}

/** Loads the picked town's YAML into the database as a draft (status is never changed here). */
export async function syncDraftTown(
  db: Db,
  townFile: string,
): Promise<{ id: string; config: TownConfig }> {
  const config = parseTownConfig(readFileSync(townFile, 'utf8'), townFile);
  await syncTowns(db, [{ config, theme: defaultTheme, hasThemeFile: false }]);
  const [row] = await db.select({ id: towns.id }).from(towns).where(eq(towns.slug, config.slug));
  return { id: row!.id, config };
}

function picked(names: NamesDetail | undefined) {
  if (!names?.picked) throw new Error('Step 2 has no picked name.');
  return names.picked;
}

export async function sourcesStep(input: {
  deps: SourceStepDeps;
  town: ResolvedTown;
  names: NamesDetail;
  flags: string[];
  outlets: string[];
  launchStartedAt: Date;
}): Promise<{ detail: DiscoverDetail }> {
  const { deps, town } = input;
  const choice = picked(input.names);
  const draft = await syncDraftTown(deps.db, choice.townFile);
  const now = deps.now();
  const candidates: Array<{ kind: Finding['kind']; url: string; origin: Finding['origin'] }> =
    parseSourceFlags(input.flags).map((f) => ({ ...f, origin: 'flag' }));

  let mode: DiscoverDetail['mode'] = 'manual';
  let outlets: DiscoverDetail['outlets'] = [];
  if (deps.llm?.provider.webSearch) {
    mode = 'model';
    const { value } = await callModel(deps.llm, {
      job: 'launch.discover',
      town: await launchLlmTown(
        deps.db,
        { id: draft.id, timezone: town.timezone },
        input.launchStartedAt,
      ),
      prompt: discoverV1,
      input: [
        `Town: ${town.name}, ${town.state}`,
        `County: ${town.county} County`,
        `Government: ${town.agencies.join('; ')}`,
        town.sameNameElsewhere.length
          ? `Not to be confused with: ${town.sameNameElsewhere.join('; ')}`
          : null,
      ]
        .filter(Boolean)
        .join('\n'),
    });
    outlets = value.outlets;
    for (const s of value.sources)
      if (!candidates.some((c) => c.kind === s.kind && c.url === s.url))
        candidates.push({ kind: s.kind, url: s.url, origin: 'model' });
  }

  // A name that resembles an outlet discovery found can't be used (§10b): pick again.
  const clash = resemblesOutlet(
    choice.siteName,
    outlets.map((o) => o.name),
  );
  if (clash)
    throw new Error(
      `${choice.siteName} ${clash}, found in discovery. Pick another name with --resume --pick N --outlet "<that outlet>".`,
    );

  const findings: Finding[] = await stateSources(deps.fetcher, town, now);
  for (const c of candidates) findings.push(await verifyUrl(deps.fetcher, c, now));
  return { detail: { mode, findings, outlets, flags: input.flags } };
}

function adapterRequests(town: ResolvedTown, findings: Finding[]): string {
  const open = findings.filter((f) => f.status === 'unknown' || f.status === 'no-feed');
  const closed = findings.filter((f) => f.status === 'blocked' || f.status === 'unreadable');
  return `# Adapter requests for ${town.name}, ${town.state}

Launch step 4 (CLAUDE.md §10; D-M7-7). Pages discovery found that no adapter can read yet. Each
one is built in a Claude Code session on a branch, with recorded fixtures and tests, then reviewed.

${
  open
    .map(
      (f) => `## ${f.kind}: ${f.url}

- Platform: ${f.platform ?? f.hint ?? 'unknown'}${f.platform ? ' (adapter matched, but no feed for this kind)' : ''}
- Found by: ${f.origin}
- Detail: ${f.detail}`,
    )
    .join('\n\n') || 'None: every readable page matched an adapter.'
}

## Not readable (not requests: Rule 8 or the site refused us)

${closed.map((f) => `- ${f.kind}: ${f.url} (${f.status}): ${f.detail}`).join('\n') || '- None.'}
`;
}

export async function adaptersStep(input: {
  deps: SourceStepDeps;
  town: ResolvedTown;
  names: NamesDetail;
  discovery: DiscoverDetail;
  launchDir: string;
}): Promise<{ detail: unknown; files: string[] }> {
  const { deps, town, discovery } = input;
  const choice = picked(input.names);
  const config = parseTownConfig(readFileSync(choice.townFile, 'utf8'), choice.townFile);
  const found = verifiedSources(discovery.findings);
  const keep = config.sources.filter((s) => s.kind === 'weather');
  const sources: TownSourceConfig[] = [...keep, ...found];
  const text = withSources(readFileSync(choice.townFile, 'utf8'), sources, discovery.findings);
  parseTownConfig(text, choice.townFile);
  writeFileSync(choice.townFile, text);
  await syncDraftTown(deps.db, choice.townFile);

  const dir = join(input.launchDir, town.slug);
  mkdirSync(dir, { recursive: true });
  const requests = join(dir, 'adapter-requests.md');
  writeFileSync(requests, adapterRequests(town, discovery.findings));
  const count = (s: Finding['status']) => discovery.findings.filter((f) => f.status === s).length;
  return {
    detail: {
      sources: found.length,
      matched: count('matched'),
      requests: count('unknown') + count('no-feed'),
      blocked: count('blocked'),
      unreadable: count('unreadable'),
    },
    files: [choice.townFile, requests],
  };
}

/** Replaces the YAML's `sources:` block, keeping the rest of the file (and its comments). */
export function withSources(
  yaml: string,
  sources: TownSourceConfig[],
  findings: Finding[],
): string {
  const labels = new Map(
    findings.flatMap((f) =>
      f.sources.map((s) => [
        JSON.stringify([s.kind, s.platform, s.url ?? '', s.options ?? {}]),
        `${s.label} (verified by launch step 3)`,
      ]),
    ),
  );
  const block = sources
    .map((s) => {
      const label = labels.get(JSON.stringify([s.kind, s.platform, s.url ?? '', s.options ?? {}]));
      const item = stringify([s], { flowCollectionPadding: true }).trimEnd().replace(/^/gm, '  ');
      return label ? `  # ${label}\n${item}` : item;
    })
    .join('\n');
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => l.startsWith('sources:'));
  if (start < 0) throw new Error('The town YAML has no sources: block.');
  let end = start + 1;
  while (
    end < lines.length &&
    (lines[end]!.startsWith(' ') || lines[end]!.startsWith('#') || lines[end] === '')
  )
    end++;
  return [...lines.slice(0, start), 'sources:', block, ...lines.slice(end)].join('\n');
}

export async function readinessStep(input: {
  deps: SourceStepDeps;
  names: NamesDetail;
  launchStartedAt: Date;
}): Promise<{ detail: ReadinessDetail }> {
  const { deps } = input;
  const choice = picked(input.names);
  const draft = await syncDraftTown(deps.db, choice.townFile);
  const llm = deps.llm;
  if (llm) {
    // Readiness calls share the launch's budget; refuse up front if it's spent.
    await launchLlmTown(
      deps.db,
      { id: draft.id, timezone: draft.config.timezone },
      input.launchStartedAt,
    );
  }
  const detail = await measureReadiness({
    db: deps.db,
    townId: draft.id,
    fetcher: deps.fetcher,
    ...(llm ? { llm } : {}),
    now: deps.now(),
  });
  // Rule 7 is a target, not a gate (owner, 2026-10-17): a town short of it still launches, and
  // the report turns the gap into a list of sources to find.
  return { detail };
}
