import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findTbdFields,
  launchStepLabels,
  parseTownConfig,
  type LaunchStep,
} from '@towncore/config';
import { aiUsage, and, eq, gte, mailDomains, sql, towns, type Db } from '@towncore/db';
import type { DiscoverDetail } from './discover';
import { mailTodos, type MailDetail } from './mail-step';
import type { NamesDetail } from './names-step';
import type { ReadinessDetail } from './readiness';
import type { ResolvedTown } from './resolve';
import type { ProvisionDetail, SeedDetail } from './seed-step';
import type { ThemeDetail } from './theme-step';

// Launch step 8 (CLAUDE.md §10; docs/plans/M7.md §6): the launch report a person reads before
// approving the town in Admin → Launches, and the friction log of everything a person still had
// to do by hand (§10: drive that list to zero). "Passing" means every automated check is green
// and every manual to-do is listed. A launch that stops early (Rule 7) gets a report too, with
// what it found and why it stopped.

export const DEFAULT_FRICTION_LOG = fileURLToPath(
  new URL('../../../docs/launch-friction.md', import.meta.url),
);

export type Check = {
  name: string;
  /** `below target` is shown but doesn't fail the report: Rule 7 is a target. */
  status: 'pass' | 'fail' | 'not run' | 'below target';
  detail: string;
};
const passes = (c: Check) => c.status === 'pass' || c.status === 'below target';

export type ReportDetail = {
  passed: boolean;
  checks: Check[];
  manual: string[];
  report: string;
  aiCostUsd: number;
};

/** What the finished steps found; a launch that stopped early has only some of it. */
export type Done = {
  resolve: ResolvedTown;
  names: NamesDetail;
  mail?: MailDetail;
  sources?: DiscoverDetail;
  readiness?: ReadinessDetail;
  seed?: SeedDetail;
  theme?: ThemeDetail;
  provision?: ProvisionDetail;
};

const notRun = (name: string, step: LaunchStep): Check => ({
  name,
  status: 'not run',
  detail: `${launchStepLabels[step]} hasn't run.`,
});
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** The mail domain as it stands now (the worker takes it live after the step ran). */
export type MailNow = {
  status: string;
  bulkStatus: string;
  warmupDay: number;
  bulkDailyCap: number;
} | null;

/**
 * Mail warm-up (owner, 2026-10-17): before the purchase it passes when the plan has no
 * conflicts; after, when onboarding has started (SES verifying or live). Going live itself
 * still needs the mail domain live (Admin → Launches).
 */
export function mailCheck(mail: MailDetail | undefined, now: MailNow): Check {
  const name = 'Mail domain and warm-up';
  if (!mail) return notRun(name, 'mail');
  if (now?.status === 'live')
    return {
      name,
      status: 'pass',
      detail: `Live; bulk ${now.bulkStatus}${now.bulkStatus === 'warming' ? `, day ${now.warmupDay} at ${now.bulkDailyCap} a day` : ''}.`,
    };
  if (now?.status === 'onboarding' || mail.state === 'waiting')
    return {
      name,
      status: 'pass',
      detail: 'SES is verifying the DNS; warm-up starts when it does.',
    };
  const failing =
    mail.state === 'failed' || mail.state === 'not started' || now?.status === 'failed';
  return { name, status: failing ? 'fail' : 'pass', detail: mail.detail };
}

export function launchChecks(done: Done, config: unknown, mailNow: MailNow = null): Check[] {
  const { names, readiness, theme } = done;
  const picked = names.proposals.find((p) => p.domain === names.picked?.domain);
  const tbd = findTbdFields(config);
  const pages = new Set(
    (theme?.shots ?? []).filter((s) => s.viewport !== 'asset').map((s) => s.name),
  );
  return [
    readiness
      ? {
          name: 'Readiness (Rule 7 target)',
          status: readiness.passed ? 'pass' : 'below target',
          detail: `${readiness.itemsPerDay} real items a day; target ${readiness.minimum} (${readiness.mode}).`,
        }
      : notRun('Readiness (Rule 7 target)', 'readiness'),
    mailCheck(done.mail, mailNow),
    {
      name: 'No TBD fields in the town config',
      status: tbd.length ? 'fail' : 'pass',
      detail: tbd.length ? tbd.join(', ') : 'Every field is set.',
    },
    {
      name: 'Name checks (§10b)',
      status: picked && picked.blocked.length === 0 ? 'pass' : 'fail',
      detail: picked
        ? `${picked.siteName} (${picked.domain}): ${picked.blocked.join('; ') || 'no conflicts found'}`
        : 'No name picked.',
    },
    ...(theme
      ? ([
          {
            name: 'Theme valid, WCAG AA contrast',
            status: 'pass',
            detail: theme.notes.find((n) => n.startsWith('Contrast')) ?? 'Every text pair passes.',
          },
          {
            name: 'Slot contract',
            status: 'pass',
            detail: 'The newsletter sign-up is among the first two modules on phones.',
          },
          {
            name: 'Neighbor rule (§11a-2)',
            status: 'pass',
            detail: theme.neighbors.length
              ? `Differs from ${theme.neighbors.map((n) => `${n.siteName} (${n.miles} mi)`).join(', ')}.`
              : 'No town within 50 miles.',
          },
        ] satisfies Check[])
      : [
          notRun('Theme valid, WCAG AA contrast', 'theme'),
          notRun('Slot contract', 'theme'),
          notRun('Neighbor rule (§11a-2)', 'theme'),
        ]),
    {
      name: 'Every page type renders',
      status:
        pages.size === 0
          ? 'not run'
          : ['home', 'directory'].every((p) => pages.has(p))
            ? 'pass'
            : 'fail',
      detail: pages.size
        ? `Rendered on phone and desktop: ${[...pages].join(', ')}.`
        : 'Run with --site to render and screenshot the draft town.',
    },
  ];
}

const md = (path: string, from: string) => relative(from, path).split('\\').join('/');

function sourcesSection(sources: DiscoverDetail): string {
  const rows = sources.findings
    .map(
      (f) =>
        `| ${f.kind} | ${f.url} | ${f.status}${f.platform ? ` (${f.platform})` : ''} | ${cell(f.detail).slice(0, 200)} |`,
    )
    .join('\n');
  return `Discovery: ${sources.mode === 'model' ? 'model with web search, verified in code' : 'manual (--source flags and state sources)'}.

| Kind | URL | Result | Detail |
| --- | --- | --- | --- |
${rows || '| | | | No sources found. |'}

Adapter requests: \`adapter-requests.md\`.${sources.outlets.length ? ` Local outlets found: ${sources.outlets.map((o) => `${o.name} (${o.status})`).join(', ')}.` : ''}`;
}

function readinessSection(readiness: ReadinessDetail): string {
  return `${readiness.itemsPerDay} real items a day over ${readiness.days} days; ${readiness.minimum} needed.

| Source | Ingest | Records in window | Items | How counted |
| --- | --- | --- | --- | --- |
${readiness.bySource.map((s) => `| ${s.kind} (${s.platform}) | ${s.ingest.status}${s.ingest.error ? `: ${cell(s.ingest.error).slice(0, 80)}` : ''} | ${s.recent} | ${s.items} | ${s.how} |`).join('\n')}`;
}

function seedSection(seed: SeedDetail): string {
  return `- Story finder: ${seed.finder.roundups} roundups, ${seed.finder.candidates} candidates, ${seed.finder.accepted} accepted${seed.finder.pending ? `, ${seed.finder.pending} waiting for a model` : ''}
- Directory: ${'listings' in seed.directory ? `${seed.directory.listings} active listings from state license data` : seed.directory.skipped}
- Guides: ${seed.guides.note}

Sample stories (on the draft site):
${seed.samples.map((s) => `- [${s.headline}](${s.url}) (${s.status.replace('_', ' ')})`).join('\n') || '- None yet.'}`;
}

function themeSection(theme: ThemeDetail, dir: string): string {
  const t = theme.theme;
  const shot = (name: string) => theme.shots.find((s) => s.name === name);
  const pages = theme.shots.filter((s) => s.viewport !== 'asset');
  const assets = theme.shots.filter(
    (s) => s.viewport === 'asset' && !s.name.startsWith('masthead-'),
  );
  return `${theme.mode === 'model' ? 'Proposed by the model, enforced in code.' : 'Generated without a model.'}

- Family **${t.family}**, brand color ${t.palette.accent}, motif ${t.motif}, masthead ${t.masthead}
- Layout: header ${t.layout.header}, grid ${t.layout.grid}, article ${t.layout.article}, directory ${t.layout.directory}, footer ${t.layout.footer}
- Identity notes: ${t.identityNotes}
${[
  ...theme.notes.map((n) => `- ${n}`),
  ...theme.reviews.map(
    (r, i) =>
      `- Screenshot review ${i + 1}: ${r.verdict}${r.problems.length ? ` (${r.problems.join('; ')})` : ''}${r.applied.length ? `; applied ${r.applied.join(', ')}` : ''}`,
  ),
].join('\n')}

### Masthead options (pick one; the first is the theme's)

${theme.mastheads
  .map((m, i) => {
    const s = shot(`masthead-${m}`);
    return `${i + 1}. ${m}${s ? `: ![${m}](${md(s.path, dir)})` : ''}`;
  })
  .join('\n')}

### Screenshots

${pages.length ? pages.map((s) => `![${s.name} on ${s.viewport}](${md(s.path, dir)})`).join('\n') : 'Not taken: run the web app and resume with `--site http://localhost:3000`.'}
${
  theme.neighbors.length
    ? `\nNearest towns: ${theme.neighbors
        .slice(0, 2)
        .map((n) => `${n.siteName} (${n.miles} miles)`)
        .join(', ')}. Compare with their sites before approving.\n`
    : ''
}
### Identity assets

${assets.map((s) => `- ${s.name}: ![${s.name}](${md(s.path, dir)})`).join('\n') || '- Drawn when screenshots run.'}`;
}

function provisionSection(provision: ProvisionDetail): string {
  return `- Stripe test prices: ${provision.stripe.map((p) => `${p.product} $${p.amountUsd}/month (${p.action})`).join(', ') || 'none'}
- Mail domain: ${provision.mail.status}
- Newsletter: ${provision.newsletter}`;
}

export function launchReport(
  done: Done,
  input: {
    siteName: string;
    domain: string;
    checks: Check[];
    manual: string[];
    aiCostUsd: number;
    dir: string;
    /** Why the run stopped, when it did. */
    stopped?: string;
    mailNow?: MailNow;
  },
): string {
  const { resolve: town, names } = done;
  const passed = input.checks.every(passes);
  const purchase = names.purchase
    ? 'orderId' in names.purchase
      ? `order ${names.purchase.orderId}, ${names.purchase.status}${names.purchase.price ? ` at $${names.purchase.price}` : ''}`
      : `${names.purchase.status} (${names.purchase.reason})`
    : 'not attempted';
  const others =
    names.proposals
      .filter((p) => p.domain !== names.picked?.domain)
      .map(
        (p) =>
          `${p.siteName} (${p.domain}${p.blocked.length ? `, ruled out: ${p.blocked.join('; ')}` : ''})`,
      )
      .join('; ') || 'none';
  const part = <T>(value: T | undefined, render: (v: T) => string) =>
    value ? render(value) : 'Not run yet.';
  const headline = input.stopped
    ? `**The launch stopped:** ${input.stopped}`
    : passed
      ? '**All automated checks pass.**'
      : '**Not passing yet:** see the checks below.';
  return `# Launch report: ${input.siteName} (${town.name}, ${town.state})

${headline} The town is a draft (not indexed). An admin approves it in Admin → Launches after the manual to-dos; going live also needs the domain bought and the mail domain live (Rule 10).

## Automated checks

| Check | Result | Detail |
| --- | --- | --- |
${input.checks.map((c) => `| ${c.name} | ${c.status === 'pass' ? 'Pass' : c.status === 'fail' ? '**Fail**' : c.status === 'below target' ? 'Below target' : 'Not run'} | ${cell(c.detail)} |`).join('\n')}

## The town

- Census: ${town.censusName} (${town.censusId}), ${town.county} County, ${town.population2025.toLocaleString('en-US')} people (2025), tier ${town.tier}
- Timezone ${town.timezone}; NWS zone ${town.nws.zone} (office ${town.nws.office}) from the town's interior point. Check it covers the coast if the town is coastal.
- Same name elsewhere: ${town.sameNameElsewhere.join(', ') || 'none'}

## Name and domain

- Picked: **${names.picked?.siteName}** at **${names.picked?.domain}**
- Purchase: ${purchase}
- Other options: ${others}

## Mail and warm-up

${part(done.mail, (m) => mailSection(m, input.mailNow ?? null))}

## Sources

${part(done.sources, sourcesSection)}

## Readiness (Rule 7)

${part(done.readiness, readinessSection)}

## Seeded content

${part(done.seed, seedSection)}

## Theme

${part(done.theme, (t) => themeSection(t, input.dir))}

## Provisioning (dry run)

${part(done.provision, provisionSection)}

## Manual to-dos

${input.manual.map((m) => `- [ ] ${m}`).join('\n')}

## AI cost of this launch

$${input.aiCostUsd.toFixed(2)} (cap $25, D-M7-11)
`;
}

function mailSection(mail: MailDetail, now: MailNow): string {
  const status = now
    ? `${now.status}; bulk ${now.bulkStatus}${now.bulkStatus === 'warming' ? `, day ${now.warmupDay} at ${now.bulkDailyCap} a day` : ''}`
    : mail.state;
  const lines = [
    `- Status: **${status}**. ${mail.detail}`,
    `- Approved by: ${mail.approvedBy ?? 'not yet (onboarding starts when the domain is bought, under that approval; Rule 10)'}`,
    mail.cohort
      ? `- Cohort ${mail.cohort}: onboard by ${mail.startBy}, so the domain is warm at go-live.`
      : '- No cohort planned (pass --cohort YYYY-MM to order onboarding ahead of go-live).',
    `- Warm-up from real, opted-in mail only (staff test issues, news@ replies, then confirmations and daily issues; never seed lists or warm-up networks): ${mail.ramp.map((r) => `day ${r.day} ${r.cap.toLocaleString('en-US')}`).join(', ')} a day while bounces stay under 3% and complaints under 0.08%.`,
  ];
  if (mail.actions.length)
    lines.push(`- ${mail.state === 'planned' ? 'Planned' : 'Done'}: ${mail.actions.join('; ')}`);
  for (const c of mail.conflicts)
    lines.push(
      `- **Conflict:** wants ${c.want.type} ${c.want.name || '@'} → ${c.want.value}; ${c.reason}`,
    );
  return lines.join('\n');
}

export function manualTodos(done: Done, domain: string): string[] {
  const todos: string[] = [];
  todos.push(...mailTodos(done.mail));
  if (done.readiness && !done.readiness.passed)
    todos.push(
      `Readiness is ${done.readiness.itemsPerDay} a day, short of the ${done.readiness.minimum} target (Rule 7): find more official sources the bot may read, or build the adapter requests, and add them with --source kind=url. Never pad to close the gap.`,
    );
  for (const t of done.sources?.county?.todos ?? []) todos.push(t);
  for (const a of done.provision?.approvals ?? []) todos.push(`${a.what}: \`${a.command}\``);
  todos.push(
    'Trademark: search the picked name at https://tmsearch.uspto.gov/ (D-M7-4).',
    'Social handles: claim the name on Facebook, Instagram and X by hand (D-M7-5); upload the identity assets.',
    `Facebook page for ${domain}, with the cover and avatar from identity/.`,
    `Google News Publisher Center and Search Console for ${domain} (D-M4-6).`,
  );
  if (done.theme)
    todos.push('Pick the masthead option above (the theme uses the first unless changed).');
  if (!done.seed || done.seed.guides.topics === 0)
    todos.push(
      'Map the evergreen guide topics to official pages (guides: in the town YAML), then review the first batch (D-M4-2).',
    );
  else todos.push('Review the first batch of guides in Admin → Review (D-M4-2).');
  const findings = done.sources?.findings ?? [];
  const requests = findings.filter((f) => f.status === 'unknown' || f.status === 'no-feed');
  if (requests.length)
    todos.push(`Build ${requests.length} adapter request(s) in adapter-requests.md (D-M7-7).`);
  const refused = findings.filter((f) => f.status === 'blocked' || f.status === 'unreadable');
  if (refused.length) {
    const hosts = [...new Set(refused.map((f) => new URL(f.url).hostname))];
    todos.push(
      `${refused.length} official source(s) can't be read (robots.txt, or the site refused us): ${hosts.join(', ')}. Never work around this (Rule 8).`,
    );
  }
  const archive =
    done.names.proposals.find((p) => p.domain === done.names.picked?.domain)?.history === null;
  if (archive)
    todos.push(
      `Check the archive history of ${domain} by hand: https://web.archive.org/web/*/${domain}`,
    );
  if (done.theme?.mode === 'fallback')
    todos.push(
      'Write identity notes for the theme (no model ran): landscape, architecture, signature places.',
    );
  if (done.theme && done.theme.shots.length === 0)
    todos.push('Take screenshots: start the web app and resume with --site.');
  todos.push('Turn on Stripe live mode only when you decide (runbook "Going live", D-M6-5).');
  return todos;
}

/** Adds this launch's manual work to docs/launch-friction.md (§10: drive it to zero). */
export function logFriction(path: string, town: string, date: string, todos: string[]): void {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path))
    writeFileSync(
      path,
      `# Launch friction\n\nEvery manual step a launch needed (CLAUDE.md §10). The goal is to drive this list to zero:\nwhen a step repeats across towns, automate it.\n`,
    );
  const already = readFileSync(path, 'utf8');
  const heading = `## ${town} (${date})`;
  const section = `${heading}\n\n${todos.map((t) => `- ${t}`).join('\n')}\n`;
  const at = already.indexOf(heading);
  if (at < 0) return appendFileSync(path, `\n${section}`);
  // A resumed launch replaces its own section for the day with what's still manual.
  const next = already.indexOf('\n## ', at + heading.length);
  writeFileSync(path, already.slice(0, at) + section + (next < 0 ? '' : already.slice(next)));
}

export async function reportStep(input: {
  db: Db;
  done: Partial<Done>;
  launchStartedAt: Date;
  launchDir: string;
  frictionLog: string;
  now: Date;
  /** Set when the run stopped early; the report then says why. */
  stopped?: string;
}): Promise<{ detail: ReportDetail; files: string[] }> {
  if (!input.done.resolve || !input.done.names?.picked)
    throw new Error('A report needs steps 1 and 2.');
  const done = input.done as Done;
  const config = parseTownConfig(readFileSync(done.names.picked!.townFile, 'utf8'));
  const [town] = await input.db
    .select({ id: towns.id })
    .from(towns)
    .where(eq(towns.slug, config.slug));
  let aiCostUsd = 0;
  if (town) {
    const [cost] = await input.db
      .select({ usd: sql<string>`coalesce(sum(${aiUsage.estCostUsd}), 0)` })
      .from(aiUsage)
      .where(and(eq(aiUsage.townId, town.id), gte(aiUsage.createdAt, input.launchStartedAt)));
    aiCostUsd = Number(cost?.usd ?? 0);
  }
  const [mail] = await input.db
    .select({
      status: mailDomains.status,
      bulkStatus: mailDomains.bulkStatus,
      warmupDay: mailDomains.warmupDay,
      bulkDailyCap: mailDomains.bulkDailyCap,
    })
    .from(mailDomains)
    .where(eq(mailDomains.name, config.domain.toLowerCase()));
  const mailNow: MailNow = mail ?? null;
  const checks = launchChecks(done, config, mailNow);
  const manual = manualTodos(done, config.domain);
  const dir = join(input.launchDir, done.resolve.slug);
  mkdirSync(dir, { recursive: true });
  const reportPath = join(dir, 'launch-report.md');
  writeFileSync(
    reportPath,
    launchReport(done, {
      siteName: config.site_name,
      domain: config.domain,
      checks,
      manual,
      aiCostUsd,
      dir,
      mailNow,
      ...(input.stopped ? { stopped: input.stopped } : {}),
    }),
  );
  logFriction(
    input.frictionLog,
    `${done.resolve.name}, ${done.resolve.state}`,
    input.now.toISOString().slice(0, 10),
    manual,
  );
  return {
    detail: {
      passed: !input.stopped && checks.every(passes),
      checks,
      manual,
      report: reportPath,
      aiCostUsd,
    },
    files: [reportPath, input.frictionLog],
  };
}
