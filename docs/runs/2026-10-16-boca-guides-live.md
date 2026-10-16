# Boca guides: first live run (2026-10-16)

M4 PR F (`docs/plans/M4.md` §5, D-M4-2). The 30 Boca guide topics in `towns/fl/boca-raton.yaml`,
written live on the draft site through the normal pipeline (`pnpm ingest:once boca-raton`, then
`pnpm stories:once boca-raton`). Model: `gemini-flash-lite-latest` for writing and fact-check
(free tier, development provider). AI cost $0.

## Ingest

All 30 reference sources fetched cleanly through the bot's fetcher: 47 official pages (26 topics
from www.myboca.us; the others add floridadisaster.org, dos.fl.gov, pbcpao.gov, pbctax.gov and
palmbeachschools.org, which asks a 5-second Crawl-delay). Every page has its main text stored as a
`page` record; health `ok` on all 30.

## Writing

| Outcome | Guides | Topics |
| --- | --- | --- |
| Passed every check; in review as the first batch (D-M4-2) | 14 | boil-water-notices, business-tax-receipt, camps, emergency-alerts, flood-zones, hire-a-contractor, library-card, parking, permit-search, pets, recreation-registration, storm-debris, voting, water-restrictions |
| Failed fact-check after one revise; in review | 14 | e.g. bulk-waste ("City Code of Ordinances" is not on the page), beach-permits (a garbled hours sentence), report-a-concern (a quote not verbatim), council-meetings |
| Blocked by the minor rule (§7), reviewer may override | 2 | schools-enrollment ("5 years old"), tennis-pickleball ("17 years old") |

Nothing is public: the first batch waits for a person in `/admin/review`.

## Fixed from the run

- The name check read the writer's own subheadings ("## Proving Residency") as names, and joined
  names across a sentence ending in a capital letter ("A1A. Bark Beach"). Subheadings are now left
  out of the name check (their numbers are still checked), and sentences also end after a capital.
- The fact-check answer for a long guide hit the stories' 12,000-token limit on 8 of 30 guides
  (a model error, so review). Guides now give the same fact-check prompt 24,000 tokens; the 8
  re-ran with no errors (largest answer 15,130 tokens).

## Open

- A reviewer works through the 30 in `/admin/review`. Once 30 guides are published, later guides
  and refreshes that pass every check publish on their own as Tier 1.
- About half the drafts fail fact-check on Flash-Lite, as with stories; revisit with Claude or a
  paid tier before launch.
- Guide eval cases (`packages/prompts/evals/`) for the new `guide v1` prompt.
