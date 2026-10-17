import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTownConfig, type TownSourceConfig } from '@towncore/config';
import { and, asc, eq, isNull, sourceKey, sourceProposals, towns, type Db } from '@towncore/db';
import { stringify } from 'yaml';
import { DEFAULT_LAUNCH_DIR } from './launch';
import { DEFAULT_TOWNS_DIR } from './names-step';

// `pnpm sources:export` (owner, 2026-10-17; docs/plans/agentic-ops.md). The worker can't open pull
// requests, so sources approved in Admin → Proposals live in the database first; this writes each
// one into its town's YAML (towns/<st>/<slug>.yaml, or the launch's draft under docs/launches/), so
// a Claude Code session can commit them in a pull request. Every file is validated before it is
// written; an approved adapter request is listed for a session to build instead.

export type ExportResult = {
  written: Array<{ file: string; town: string; added: string[] }>;
  adapterRequests: Array<{ town: string; kind: string; url: string; platform: string | null }>;
  missing: Array<{ town: string; reason: string }>;
};

/** The town's YAML file: its live place in towns/, or its launch draft. */
export function townFile(
  town: { slug: string; state: string },
  dirs: { towns?: string; launches?: string } = {},
): string | null {
  const live = join(dirs.towns ?? DEFAULT_TOWNS_DIR, town.state.toLowerCase(), `${town.slug}.yaml`);
  if (existsSync(live)) return live;
  const draft = join(dirs.launches ?? DEFAULT_LAUNCH_DIR, town.slug, 'town', `${town.slug}.yaml`);
  return existsSync(draft) ? draft : null;
}

/** Adds sources to the end of a town YAML's `sources:` list (the caller validates the result). */
export function withAddedSources(
  yaml: string,
  add: Array<{ source: TownSourceConfig; note: string }>,
): string {
  const have = new Set(parseTownConfig(yaml).sources.map((s) => sourceKey(s)));
  const items: string[] = [];
  for (const { source, note } of add) {
    if (have.has(sourceKey(source))) continue;
    have.add(sourceKey(source));
    // The usual key order of a town YAML source (jsonb doesn't keep it).
    const ordered = Object.fromEntries(
      ['kind', 'platform', 'url', 'zone', 'point', 'schedule', 'options']
        .filter((k) => (source as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, (source as Record<string, unknown>)[k]]),
    );
    const item = stringify([ordered]).trimEnd().replace(/^/gm, '  ');
    items.push(`  # ${note}\n${item}`);
  }
  if (!items.length) return yaml;
  // Inserted as text at the end of the `sources:` block: the rest of the file, its comments and
  // its formatting stay exactly as they are.
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => l.startsWith('sources:'));
  if (start < 0) throw new Error('The town YAML has no sources: block.');
  let end = start + 1;
  while (
    end < lines.length &&
    (lines[end]!.startsWith(' ') || lines[end]!.startsWith('#') || lines[end] === '')
  )
    end++;
  // Blank lines and comments at the end belong to what follows the block.
  while (end > start + 1 && !lines[end - 1]!.startsWith('  ')) end--;
  return [...lines.slice(0, end), ...items, ...lines.slice(end)].join('\n');
}

export async function exportApprovedSources(
  db: Db,
  opts: { dirs?: { towns?: string; launches?: string }; dryRun?: boolean; now?: Date } = {},
): Promise<ExportResult> {
  const rows = await db
    .select({ p: sourceProposals, slug: towns.slug, state: towns.state, siteName: towns.siteName })
    .from(sourceProposals)
    .innerJoin(towns, eq(towns.id, sourceProposals.townId))
    .where(and(eq(sourceProposals.status, 'approved'), isNull(sourceProposals.exportedAt)))
    .orderBy(asc(towns.slug), asc(sourceProposals.createdAt));
  const result: ExportResult = { written: [], adapterRequests: [], missing: [] };
  const byTown = new Map<string, typeof rows>();
  for (const r of rows) {
    if (r.p.type === 'adapter') {
      result.adapterRequests.push({
        town: r.siteName,
        kind: r.p.kind,
        url: r.p.url,
        platform: r.p.platform,
      });
      continue;
    }
    byTown.set(r.slug, [...(byTown.get(r.slug) ?? []), r]);
  }
  for (const [, list] of byTown) {
    const first = list[0]!;
    const file = townFile({ slug: first.slug, state: first.state }, opts.dirs);
    if (!file) {
      result.missing.push({ town: first.siteName, reason: 'no town YAML on this machine' });
      continue;
    }
    const date = (opts.now ?? new Date()).toISOString().slice(0, 10);
    const text = withAddedSources(
      readFileSync(file, 'utf8'),
      list.map((r) => ({
        source: r.p.config as TownSourceConfig,
        note: `${r.p.label} (found by source discovery, approved ${r.p.decidedAt?.toISOString().slice(0, 10) ?? date})`,
      })),
    );
    parseTownConfig(text, file);
    if (!opts.dryRun) {
      writeFileSync(file, text);
      for (const r of list)
        await db
          .update(sourceProposals)
          .set({ exportedAt: opts.now ?? new Date() })
          .where(eq(sourceProposals.id, r.p.id));
    }
    result.written.push({ file, town: first.siteName, added: list.map((r) => r.p.label) });
  }
  return result;
}
