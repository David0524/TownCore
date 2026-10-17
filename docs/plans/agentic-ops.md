# Agentic operations: connected systems (owner, 2026-10-17)

The owner's direction: "The daily news loop already runs on its own. Make the rest work the same
way: each finished step starts the next, agents do the work and prepare each decision, people
approve with one click."

Five loops are built. Each one records its state in the database, so a crash resumes where it
stopped, and each one ends in a decision a person makes in Admin.

## What runs when

| Loop | Runs | Where | Model |
| --- | --- | --- | --- |
| Launch cohorts | Every 5 minutes, only with `COHORT_ORCHESTRATOR=worker`; otherwise `pnpm cohort advance` | `packages/launcher/src/cohort-run.ts` | Only through the launch's own steps (discovery, theme) |
| Source discovery | Weekly, Monday 08:10 UTC | `packages/launcher/src/discovery-agent.ts` | The `discover` task (web search), inside its caps |
| Adapter fix requests | Hourly at :50 | `packages/adapters/src/fixes.ts` | None |
| Learning proposals | Daily, 09:25 UTC | `packages/pipeline/src/proposals.ts` | None |
| Ops digest | Daily, 09:40 UTC (5:40 a.m. Eastern in summer, 4:40 in winter) | `packages/pipeline/src/digest.ts` | None |

No new model task was added. Every model call still goes through `callModel` with a task from the
routing table, with the caps checked before each call.

## 1. Launch cohorts

An admin picks approved towns into a cohort in Admin → Launches. A cohort is a dry run unless the
admin ticks "Buy domains when approved".

Each town moves through a chain of stages. Each finished stage starts the next in the same pass:

1. **Names.** The launch runs steps 1 and 2: it resolves the town and proposes three names with
   domains, prices and conflict checks.
2. **One purchase approval for the cohort (people).** Admin → Launches shows each town's picked
   name, domain and price, and the cohort's total. The admin can change a pick. Then the admin
   types the total back exactly and approves.
3. **Purchase.** Each domain goes through the existing registrar code (`buyDomain`, with
   `expectedPrice`). It is bought only if the quote still matches the approved domain and price.
   If the price moved, nothing is bought and the town gets a to-do.
   - The order is recorded before it is sent, so a crash never sends it twice. A pending order
     settles on a later pass.
4. **Mail onboarding.** The cohort's approval covers this step: SES identities and DNS records,
   through the same state machine as `pnpm mail:onboard`. A DNS conflict fails the town with a
   to-do and overwrites nothing.
5. **DNS verification and warm-up.** The worker's existing 5-minute mail check verifies SES and
   starts the warm-up. The town waits here until its mail domain is live.
6. **Provisioning.** The rest of the launch runs: sources, adapters, readiness, seeding, theme and
   logo prompts, the provisioning plan and the launch report.
7. **Draft review.** Every town's go-live blockers and manual to-dos show in one table, batched
   across the cohort for one pass:
   - logo art (ticked off by itself once `pnpm identity import` runs);
   - Facebook pages (ticked once `facebook:` is in the town YAML);
   - Search Console (manual until a Google credential exists);
   - the launch report's to-dos.

   They are also logged in `docs/launch-friction.md`.
8. **Go-live for the cohort (people).** One admin click. Each town is checked again with
   `goLiveBlockers` (domain bought, mail live, readiness measured); a town that fails stays in
   review with its reasons. Schedules start. The newsletter keeps its own off → test → live path.

A failed town shows its error and a Retry button. A person fixes the cause first.

**Where it runs.** The launch writes files: the town YAML, theme, launch report and logo prompts.
The worker's disk isn't the repo, so by default cohorts advance only by `pnpm cohort advance` from
a Claude Code session or a checkout, where the files land for a pull request (D-M7-9).
`COHORT_ORCHESTRATOR=worker` lets the worker run the chain every 5 minutes once it has a
persistent volume.

## 2. Source discovery

- **Which towns.** Weekly, for each town below its Rule 7 target, largest gap first (10 a run).
- **The search.** The `discover` task searches the web. It is told what the town already has and
  which kinds are missing.
- **Checks in code.** Every URL is fetched once through the polite Fetcher (robots.txt, the
  never-scrape list, 1 request a second) and matched with `detect()` and the adapter's health
  check: the same `verifyUrl` the launcher uses. A URL that robots.txt blocks or that refuses us
  is counted and dropped.
- **Known platform.** It becomes a proposed source config with an estimate, such as "+0.6 items a
  day". The estimate comes from the network's own history: published stories a day per source of
  that platform and kind over 30 days, or of that kind on any platform. With no history it says
  so; it never guesses.
- **Unknown platform.** It becomes an adapter request.
- **Approve in Admin → Proposals.**
  - Approving a source adds it to the town in the database, so ingest starts on the next tick.
  - `pnpm sources:export` writes approved sources into the town YAML (or the launch draft), for a
    pull request from a Claude Code session. It also lists approved adapter requests to build.
  - Rejected sources are never proposed again.
- **Progress.** Admin → Health shows each town's items a day by source, its gap, and a Discovery
  column (last run, waiting, approved, estimated items a day).
- The documented-API list is never touched.

## 3. Self-healing adapters

When a source turns `broken`, the worker:

1. Fetches it once more through the same Fetcher, sending through a recorder (`withFetch`, which
   shares the host pace and robots.txt cache). This records a fixture of the failing fetch.
2. Classifies the failure in code:
   - robots.txt now disallows;
   - never-scrape list;
   - HTTP 401/403, 404/410, 429 or 5xx;
   - timeout or network;
   - parse error;
   - empty compared with its history.
3. Opens a fix request with the error, the fixture and the diagnosis, in Admin → Fixes.

A source that works on the re-check opens nothing. The same failure on one platform in two or more
towns becomes one platform request that the town requests point to; fixing it closes them all.

Writing the fix is writing adapter code, which the routing table keeps out of the pipeline. A
Claude Code session does it: `docs/ops/adapter-fix-routine.md` holds the instructions a scheduled
session follows. No schedule has been created; the owner decides. A robots.txt refusal is never
worked around (Rule 8).

## 4. The daily digest

The digest is built in code from the database, with no model. Each item has a suggested action and
a link. It covers:

- **Cohort health and Google signals.** Search Console isn't connected, and the digest says so.
- **Launch cohorts in progress.**
- **AI cost.** Spend against the network cap, towns and tasks at their caps, and the +50% week
  over week rise in cost per story.
- **Sources.** Failing sources, open fix requests and platform patterns.
- **The review queue and its age.**
- **Mail.** Warm-up, pauses, bounces and complaints.
- **Proposals waiting.**

It's stored once a day (Admin → Digest, latest and history) and emailed through the alert path:
only active admins on towncore.net, and `sendStaffEmail` refuses anyone else.
`MAIL_TRANSPORT=log` logs it instead of sending; without mail set up, it stays unsent.

## 5. Learning loops (Admin → Proposals)

Daily, each loop writes a proposal. An admin approves or rejects it in one click, audited. A key
already decided is never proposed again.

- **Experiment winners.** A variant with at least 5 towns that beats the control by 10% or more on
  its own metric. Approving calls `decideExperiment`, which rolls it out network-wide. Variants
  change copy or the first two phone modules only, so the neighbor rule holds.
- **Model routing.** From live eval reports (`packages/prompts/evals/variants`). A variant that is
  no worse on safety, fact-check pass rate or unsupported claims, and better on one of them or on
  cost. The routing table is code, so approving records the decision and shows the diff to apply
  in a pull request.
- **Cohort gates.** The latest live cohort's gates from `docs/plans/rollout.md`, each pass, fail or
  unknown. The verdict is to launch or pause the next cohort.
  - Manual actions and indexing are unknown until Search Console is connected.
  - Fact-check pass rate must be at least 80%.
  - Corrections must be at most 1 a town in 30 days.
  - Sign-ups must be at least 1 a town in the audience window.

  A changed verdict supersedes the old proposal. Admin → Launches shows the last gate beside
  "Start a cohort".
- **Pricing.** The kind exists, but nothing writes it here; pricing is built elsewhere.

## What each approval covers

| Approval | Covers | Doesn't cover |
| --- | --- | --- |
| Cohort purchase (typed total) | Buying each listed domain at its listed price; mail onboarding for those domains (SES identities, DNS records) | A different domain or price; overwriting a DNS record; go-live |
| Cohort go-live | Taking each reviewed town live after its checks pass | The newsletter (its own off → test → live), production deploys |
| Source proposal | Adding that source to that town | Widening the documented-API list; ignoring robots.txt |
| Learning proposal | Its stated action (an experiment winner), or recording the decision (routing, gates) | Editing code or config |

## What stays human

These are never automated:

- buying domains, charges, and price increases on existing customers;
- sending to real people where Rule 10 needs an approval;
- production deploys;
- Tier 3 approval;
- anything that loosens a Section 2 rule or adds a paid service (§14).

The AI article reviewer stays switched off in the routing table (`reviewer.disabled`). Tier 3
still needs a person.
