import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Fetcher } from '@towncore/adapters';
import { parseTownConfig } from '@towncore/config';
import { and, isNotNull, ne, towns, type Db } from '@towncore/db';
import type { Place } from './census';
import {
  buyDomain,
  domainOrder,
  priorUse,
  registeredInRegistry,
  registrantFromEnv,
  searchDomains,
  type DomainQuote,
  type PriorUse,
  type Purchase,
} from './domains';
import {
  domainsFor,
  NEIGHBOR_MILES,
  nameCandidates,
  officialSounding,
  patternOf,
  resemblesOutlet,
  type NamePattern,
} from './names';
import { milesBetween } from './rank';
import type { ResolvedTown } from './resolve';
import { draftTownYaml, type LaunchOptions } from './launch';

// Launch step 2 (CLAUDE.md §10, §10b): three names with domains and conflict checks; the owner
// picks one (`--resume --pick N`); the town's config is then written to towns/; the domain is
// bought only with `--approve-spend`, a typed confirmation and the quoted price (Rule 10).

export const DEFAULT_TOWNS_DIR = fileURLToPath(new URL('../../../towns', import.meta.url));

export type NameDeps = {
  fetcher: Fetcher;
  /** Gazetteer places of a state, for the coordinates of towns we already run. */
  places: (state: string) => Promise<Place[]>;
  /** Env for a purchase: REGISTRAR_API_KEY, VERCEL_TEAM_ID and REGISTRANT_*. */
  env: Record<string, string | undefined>;
  /** Shows the domain and price and asks the operator to type the domain back. */
  confirmPurchase: (q: { domain: string; price: number; renewalPrice: number }) => Promise<boolean>;
};

export type Proposal = {
  siteName: string;
  pattern: NamePattern;
  domain: string;
  quote: DomainQuote;
  registered: boolean | null;
  history: PriorUse | null;
  /** Reasons the name can't be used (§10b conflict checks); empty when it's clear. */
  blocked: string[];
  /** Things a person checks before picking it. */
  review: string[];
};

export type NamesDetail = {
  proposals: Proposal[];
  neighbors: Array<{ name: string; siteName: string; pattern: NamePattern | null; miles: number }>;
  manual: string[];
  /** The --outlet names the proposals were checked against; new ones re-run the checks. */
  outlets: string[];
  picked?: { siteName: string; domain: string; townFile: string };
  purchase?: Purchase | { status: 'not bought'; reason: string };
};

async function neighborsOf(db: Db, deps: NameDeps, town: ResolvedTown) {
  const ours = await db
    .select({
      name: towns.name,
      siteName: towns.siteName,
      state: towns.state,
      censusId: towns.censusId,
    })
    .from(towns)
    .where(and(isNotNull(towns.censusId), ne(towns.status, 'paused')));
  const out: NamesDetail['neighbors'] = [];
  const networkUse: Partial<Record<NamePattern, number>> = {};
  const placesByState = new Map<string, Place[]>();
  for (const t of ours) {
    const pattern = patternOf(t.siteName);
    if (pattern) networkUse[pattern] = (networkUse[pattern] ?? 0) + 1;
    if (t.censusId === town.censusId) continue;
    if (!placesByState.has(t.state)) placesByState.set(t.state, await deps.places(t.state));
    const p = placesByState.get(t.state)!.find((x) => x.geoid === t.censusId);
    if (!p) continue;
    const miles = Math.round(milesBetween(p, town));
    if (miles <= NEIGHBOR_MILES) out.push({ name: t.name, siteName: t.siteName, pattern, miles });
  }
  return { neighbors: out.sort((a, b) => a.miles - b.miles), networkUse };
}

async function propose(db: Db, deps: NameDeps, town: ResolvedTown, opts: LaunchOptions) {
  const { neighbors, networkUse } = await neighborsOf(db, deps, town);
  const candidates = nameCandidates({
    townWord: opts.shortName ?? town.name,
    ...(opts.nickname ? { nickname: opts.nickname } : {}),
    nearbyPatterns: neighbors.flatMap((n) => (n.pattern ? [n.pattern] : [])),
    networkUse,
  });
  const quotes = new Map(
    (
      await searchDomains(
        deps.fetcher,
        candidates.flatMap((c) => domainsFor(c.siteName)),
      )
    ).map((q) => [q.domain, q]),
  );
  const proposals: Proposal[] = [];
  for (const c of candidates) {
    if (proposals.filter((p) => p.blocked.length === 0).length >= 3) break;
    const options = domainsFor(c.siteName).map(
      (d) => quotes.get(d) ?? { domain: d, available: false as const },
    );
    const quote =
      options.find((q) => q.available && !q.premium) ??
      options.find((q) => q.available) ??
      options[0]!;
    const blocked: string[] = [];
    const review: string[] = [];
    const official = officialSounding(c.siteName, quote.domain);
    if (official) blocked.push(official);
    const outlet = resemblesOutlet(c.siteName, opts.outlets ?? []);
    if (outlet) blocked.push(outlet);
    if (!quote.available) blocked.push(`${quote.domain} is taken`);
    else if (quote.premium) review.push(`${quote.domain} is a premium domain ($${quote.price})`);
    let registered: boolean | null = null;
    let history: PriorUse | null = null;
    if (quote.available && blocked.length === 0) {
      registered = await registeredInRegistry(deps.fetcher, quote.domain);
      if (registered) blocked.push(`${quote.domain} is registered at the .com registry`);
      history = await priorUse(deps.fetcher, quote.domain);
      if (!history)
        review.push(
          `The Internet Archive didn't answer for ${quote.domain}; check https://web.archive.org/web/*/${quote.domain} by hand (buying re-checks it)`,
        );
      else if (history.news)
        blocked.push(`${quote.domain} was a news site before (expired-domain abuse, §10b)`);
      else if (history.captures)
        review.push(
          `${quote.domain} had a website before (${history.years[0]}–${history.years.at(-1)}); check its archive`,
        );
    }
    proposals.push({
      siteName: c.siteName,
      pattern: c.pattern,
      domain: quote.domain,
      quote,
      registered,
      history,
      blocked,
      review,
    });
  }
  // Clear names first; blocked ones stay listed so the owner sees what was ruled out and why.
  proposals.sort((a, b) => Number(a.blocked.length > 0) - Number(b.blocked.length > 0));
  return { proposals, neighbors };
}

export function namesReport(town: ResolvedTown, detail: NamesDetail, command: string): string {
  const clear = detail.proposals.filter((p) => p.blocked.length === 0);
  return `# Names for ${town.name}, ${town.state}

Launch step 2 (CLAUDE.md §10b). Pick one with \`${command} --resume --pick N\`. A domain is bought
only with \`--approve-spend\`, after you type it back to confirm the price shown.

${
  clear.length
    ? clear
        .map(
          (p, i) => `## ${i + 1}. ${p.siteName}

- Domain: **${p.domain}** ${p.quote.available ? `$${p.quote.price} the first year, $${p.quote.renewalPrice} to renew${p.quote.premium ? ' (premium)' : ''}` : 'not available'}
- Registry (.com RDAP): ${p.registered === null ? 'not checked' : p.registered ? 'registered' : 'not registered'}
- Archive history: ${p.history === null ? 'not checked' : p.history.captures ? `${p.history.captures} yearly captures (${p.history.years[0]}–${p.history.years.at(-1)}); news signals: ${p.history.checked.flatMap((c) => c.signals).join('; ') || 'none'}` : 'none'}
${p.review.map((r) => `- **Check:** ${r}`).join('\n')}`,
        )
        .join('\n\n')
    : '**No clear name.** Every proposal was blocked; see below.'
}

## Ruled out

${
  detail.proposals
    .filter((p) => p.blocked.length)
    .map((p) => `- ${p.siteName} (${p.domain}): ${p.blocked.join('; ')}`)
    .join('\n') || '- None.'
}

## Towns within ${NEIGHBOR_MILES} miles (their patterns aren't reused)

${detail.neighbors.map((n) => `- ${n.siteName} (${n.name}), ${n.miles} miles`).join('\n') || '- None.'}

## Before you pick (manual checks)

${detail.manual.map((m) => `- [ ] ${m}`).join('\n')}
`;
}

export async function namesStep(input: {
  deps: NameDeps;
  db: Db;
  town: ResolvedTown;
  options: LaunchOptions;
  previous?: NamesDetail;
  dirs: { launch: string; towns: string };
}): Promise<{ detail: NamesDetail; files: string[]; waiting?: string }> {
  const { deps, db, town, options } = input;
  const dir = join(input.dirs.launch, town.slug);
  mkdirSync(dir, { recursive: true });
  const command = `pnpm launch "${town.name}, ${town.state}"`;

  let detail = input.previous;
  const outletsChanged =
    detail && JSON.stringify(options.outlets ?? []) !== JSON.stringify(detail.outlets ?? []);
  if (!detail?.proposals || outletsChanged) {
    const { proposals, neighbors } = await propose(db, deps, town, options);
    detail = {
      proposals,
      neighbors,
      manual: [
        'Trademark: search each name at https://tmsearch.uspto.gov/ (live and dead marks).',
        'Social handles: check Facebook, Instagram and X for each name by hand (no automated checks, D-M7-5).',
        'Local outlets: search the web for each name with the town; add any outlet found with --outlet "Name" and resume.',
      ],
      outlets: options.outlets ?? [],
    };
  }
  const reportPath = join(dir, 'names.md');
  writeFileSync(reportPath, namesReport(town, detail, command));
  const clear = detail.proposals.filter((p) => p.blocked.length === 0);

  if (!options.pick) {
    return {
      detail,
      files: [reportPath],
      waiting: clear.length
        ? `Pick a name in ${reportPath}, then run ${command} --resume --pick N.`
        : `No clear name for ${town.name}. Try --short-name or --nickname, then ${command} --resume.`,
    };
  }
  const chosen = clear[options.pick - 1];
  if (!chosen) throw new Error(`There is no clear proposal ${options.pick}; see ${reportPath}.`);

  // The town's config, now with its name and domain; validated before it's written.
  const yaml = draftTownYaml(town, options, { siteName: chosen.siteName, domain: chosen.domain });
  parseTownConfig(yaml);
  const townFile = join(input.dirs.towns, town.state.toLowerCase(), `${town.slug}.yaml`);
  mkdirSync(join(input.dirs.towns, town.state.toLowerCase()), { recursive: true });
  // Never overwrite a town someone already set up; a re-pick in this launch replaces our own file.
  if (existsSync(townFile) && detail.picked?.townFile !== townFile)
    throw new Error(`${townFile} already exists; this launch won't overwrite it.`);
  writeFileSync(townFile, yaml);
  const files = [reportPath, townFile];
  const result: NamesDetail = {
    ...detail,
    picked: { siteName: chosen.siteName, domain: chosen.domain, townFile },
  };
  if (!options.approveSpend) {
    result.purchase = { status: 'not bought', reason: 'dry run (no --approve-spend)' };
    return { detail: result, files };
  }

  // Rule 10: the money step. Fresh price, the owner's typed confirmation, then one order.
  const token = deps.env.REGISTRAR_API_KEY;
  const registrant = registrantFromEnv(deps.env);
  if (!token || registrant.contact === null)
    throw new Error(
      `Buying needs REGISTRAR_API_KEY and ${registrant.contact === null ? registrant.missing.join(', ') : ''} in the environment.`,
    );
  const [quote] = await searchDomains(deps.fetcher, [chosen.domain]);
  if (!quote?.available) throw new Error(`${chosen.domain} is no longer available.`);
  if (await registeredInRegistry(deps.fetcher, chosen.domain))
    throw new Error(`${chosen.domain} is registered at the .com registry.`);
  // Expired-domain abuse (§10b): never buy without a completed archive check.
  const history = chosen.history ?? (await priorUse(deps.fetcher, chosen.domain));
  if (!history)
    throw new Error(
      `The Internet Archive didn't answer for ${chosen.domain}; nothing was bought. Try again later.`,
    );
  if (history.news) throw new Error(`${chosen.domain} was a news site before; nothing was bought.`);
  const ok = await deps.confirmPurchase({
    domain: chosen.domain,
    price: quote.price,
    renewalPrice: quote.renewalPrice,
  });
  if (!ok) {
    result.purchase = { status: 'not bought', reason: 'the operator did not confirm' };
    return { detail: result, files };
  }
  const teamId = deps.env.VERCEL_TEAM_ID;
  const { orderId } = await buyDomain(deps.fetcher, {
    token,
    ...(teamId ? { teamId } : {}),
    domain: chosen.domain,
    expectedPrice: quote.price,
    contact: registrant.contact,
  });
  result.purchase = await domainOrder(deps.fetcher, {
    token,
    ...(teamId ? { teamId } : {}),
    orderId,
  });
  return { detail: result, files };
}
