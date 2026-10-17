# Claude model protocol (owner, 2026-10-17)

The owner adds `ANTHROPIC_API_KEY` only once the system meets three conditions:

- it calls the right model for each task;
- it uses the cheapest call that does the job well;
- it can't overspend.

All of this is built and tested with no key, using recorded responses. The live test comes after.

## 1. One routing table

Every model call names a **task**, never a model. `packages/config/src/models.ts` (`taskRoutes`) is the only place that maps a task to:

- a model size (small, mid or large);
- thinking and effort;
- `max_tokens` (the output limit);
- batching and web search;
- escalation;
- a daily cap and a per-call ceiling.

`providerModels` turns the size into a model for each provider. On Anthropic that's Haiku 5.5, Sonnet 5.5 or Opus 5.5. On Gemini, the development fallback, it's Flash-Lite, Flash-Lite or Pro.

The model IDs, prices and thinking controls were checked against Anthropic's model reference on 2026-10-17:

- Haiku 5.5 is $0.10 / $0.50 per million tokens in and out; it takes `thinking: disabled` at effort high or below.
- Sonnet 5.5 is $2 / $10; `disabled` returns an error, so it uses `between_tools`.
- Opus 5.5 is $4 / $20; thinking can't be turned off, so effort is its only control.
- Cache writes cost 1.25× the input price.
- The Batch API is half price.

| Task | Model | Thinking, effort | `max_tokens` | Notes |
| --- | --- | --- | --- | --- |
| classify | Haiku | off, low | 1,500 | Escalates to Sonnet when the answer is invalid or its confidence is under 0.6 |
| extract (entities) | Haiku | off, low | 1,500 | Escalates to Sonnet on invalid output |
| write | Sonnet | off, medium | 6,000 | |
| factcheck | Sonnet | off, high | 8,000 | A separate call, never the writer's context |
| revise | Sonnet | off, medium | 6,000 | The writer's one retry |
| update (follow-up note) | Sonnet | off, medium | 3,000 | |
| guide, guide-factcheck, guide-revise | Sonnet | off | 8,000 / 16,000 / 8,000 | Batch API |
| discover | Opus | adaptive, medium | 8,000 | Web search, up to 12 searches; inside the $25 launch cap |
| identity, theme-review | Opus | adaptive, medium | 3,000 / 2,500 | Opus or Sonnet, to be picked by eval |
| reviewer | Sonnet | adaptive, high | 4,000 | **Off** until the owner switches it on (Rule 5) |

Not in the table:

- Templated items (roundups, alerts) are built in code, with no model.
- New adapters are written in a Claude Code session, not by the pipeline.

**Thinking off for the writer and fact-check** is the starting point. The `writer-thinking` eval variant (§5) decides whether adaptive thinking earns its cost.

## 2. Code before models

Code already does everything it can:

- roundups, alerts, dates and tier rules;
- verbatim quotes, exact names and numbers;
- the wrong-town check.

The story finder also rejects these before any model call:

- other outlets and bare links;
- thin text (under 400 characters);
- a near-identical title to a story covered in the last 14 days (similarity 0.85 or higher);
- records that name a same-name place elsewhere and never this town.

## 3. Efficient calls

- **Prompt caching.**
  - The system prompt is the first cache breakpoint. It is shared by every town, so reads dominate as the network grows.
  - The town's context (name, county, agencies) is the second breakpoint, sent as a prefix before the records.
  - Cache reads and writes are logged.
- **Batch API.**
  - Guides are queued. The worker job `ai.batches` (every 10 minutes) submits up to 500 requests a batch and collects batches that have ended. Results are logged at half price.
  - The writer picks the answer up on its next run under the same request key: writer, then fact-check, then any revise, each one batch.
  - Backfills, eval runs and seeding can use the same path.
- **Structured output.** Every task returns JSON checked against a zod schema. Invalid output gets the task's one escalation if it has one; otherwise the item goes to the review queue. It never crashes the job.
- **Tight inputs and limits.** `max_tokens` is set per task, and only the trimmed source text is sent.
- **No blind retries.**
  - The SDK backs off on 429, 5xx and 529 (overloaded), at most 3 retries.
  - A request that already succeeded is never sent again: answers are kept in `ai_requests` by an idempotency key (task, provider, model, prompt, input and settings, per town).

## 4. Spending can't run away

- **What `ai_usage` logs:**
  - town, task and model;
  - uncached input, output, cache-read and cache-write tokens;
  - cost;
  - outcome (ok, refused, invalid, low_confidence, error);
  - whether the call was an escalation or batched.
- **Caps, each checked against the call's worst case before it is sent:**
  - town: per day, in the town's timezone;
  - network: $50 a day;
  - task: per day, network-wide;
  - launch: $25 a launch;
  - call: a per-call ceiling.
  - The worst case counts every input character as a third of a token, the full `max_tokens` and every allowed search.
  - Queued batch work is counted against the caps before it is billed.
- **A cap never sends work to a bigger model.** It stops the work, and Admin → Health raises an alert from 95% of a town's or a task's cap.
- **Admin → Health → "AI spend by task":**
  - for each task and model: spend, cost per published story, cache hit rate, escalations, batched share and failures;
  - the existing alert when cost per story rises more than 50% week over week.

## 5. Proved without the key

- **Routing tests** (`packages/pipeline/test/model-protocol.test.ts`):
  - every task reaches its configured model with its settings;
  - escalation fires only on invalid output or low confidence, never on a refusal and never past a cap;
  - the per-call ceiling and task caps stop work;
  - cost estimates match known token counts;
  - the batch flow submits, collects and hands back answers;
  - an identical request is never sent twice;
  - the Anthropic request shape: thinking per model, cache breakpoints, batch bodies.
- **The Claude path offline** (`test/claude-path.test.ts`):
  - the story finder on Haiku, writer and fact-check on Sonnet, the tier router and publishing;
  - a guide through the Batch API;
  - launcher discovery on Opus with web search.
  - Responses replay from `test/fixtures/llm/claude-synthetic.json`, in the same format as the Gemini recordings. It is **synthetic** (written for the test) until the key exists.
- **`pnpm ai:plan <town>`** prints what one day of the town's work would ask of the models (tasks, models, calls, tokens and cost), and a launch's one-off calls. It needs no key.
- **Evals:**
  - The 20 Boca cases still replay from the Gemini recording.
  - New cases from Delray (real Legistar actions), Harbor Point and Pine Hollow are listed as "not recorded" until a live run records them.
  - `pnpm evals --live --variant <name>` runs a routing variant and saves its quality and cost:
    - `baseline`;
    - `classify-sonnet` (Haiku against Sonnet on classify and extract);
    - `writer-thinking` (adaptive thinking on writer, revise and fact-check).
  - `pnpm evals:compare` lines the variants up, quality first, then cost.
- **Prompts:** Claude's classify prompt is v2. It adds a `confidence` field, which drives escalation. Gemini keeps v1, so its recordings stay valid.

## 6. When the key is added (owner)

1. Set `ANTHROPIC_API_KEY` and `AI_NETWORK_CAP_USD=10` (a $10 network day for the trial). Run `pnpm ai:plan boca-raton` to see the expected day.
2. Run Boca for one day. Report:
   - stories written;
   - fact-check pass rate against the Gemini baseline;
   - cost per published story by task;
   - cache hit rate;
   - escalations.

   All of these are on Admin → Health.
3. Run `pnpm evals --live`, which records Claude responses for CI. Then run the two variants and `pnpm evals:compare`.
4. Tune the routing table from the results, then raise the caps step by step.

## Not changing

- The pipeline stays model-agnostic behind `packages/pipeline/src/llm.ts`, with Gemini as the development fallback.
- The hard checks stay in code: verbatim quotes, exact names and numbers, tier rules.
- No model call decides Tier 3 or Tier 4 alone: the code's tier rules always win.
