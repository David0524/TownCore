# Ports from Kyle's TownCore (2026-10-19)

Owner: "We will use mine as the base and add on any worthwhile features from Kyle … Do it all. I
trust your judgement. No paid meeting transcription."

Source of the list: a side-by-side review of `kylerudd00-jpg/TownCore` (main `3e30c03`) against
this repo. Kyle's repo is not a fork of this one; nothing was merged, only ideas and small pure
functions were ported, each rebuilt on this repo's Fetcher, task routes, versioned prompts,
design tokens and tests.

| # | Port | Where | State |
| --- | --- | --- | --- |
| 1 | Weather page in Kyle's layout (alerts, this hour, 7 days, hour by hour) on our NWS snapshot | `components/weather/*`, `sites/[host]/weather`, `nws/weather.ts`, `config/weather.ts` | On |
| 2 | Quote check: quotations in a draft must be verbatim in a cited record | `pipeline/src/factcheck.ts` | On |
| 3 | Filler and deflection lint, fed to the one revise; leftovers go to review | `pipeline/src/style-lint.ts` | On |
| 4 | Sensitive-topic backstop (suicide, sexual offences, missing children) | `pipeline/src/tiers.ts` | On |
| 5 | Broken-source back-off; policy refusals re-checked weekly | `adapters/src/schedule.ts` | On |
| 6 | Proxies, feed bridges, scraping services and page caches on the never-scrape list | `adapters/src/http/policy.ts` | On |
| 7 | Writer v2: length bands chosen in code, headline rules, titles, press-release rules | `prompts/src/v2/writer.ts`, `HOUSE_STYLE_V2` | Off until recorded |
| 8 | Event pages with Add to calendar (.ics) and Event JSON-LD | `sites/[host]/events/[slug]` | On |
| 9 | Libel review after fact-check, raises tiers only | `prompts/src/v1/legal.ts`, `pipeline/src/legal.ts` | Off until recorded |
| 10 | Meeting splitter (one story per newsworthy decision, transcript windows) and caption uploads | `pipeline/src/meeting-split.ts`, Admin → Meetings | Splitter off until recorded; uploads on |
| 11 | Send to newsroom: an organization's own emailed release becomes a record | inbox thread panel, `pipeline/src/press-releases.ts` | On |
| 12 | CivicPlus Agenda Center agendas and minutes | `adapters/src/civicplus/agenda-center.ts` | On (Boca's Agenda Center is empty) |
| 13 | Alert kinds (breakage, backlog, standing) and score calibration | `mail/src/ops/alert-kinds.ts`, `pipeline/src/calibration.ts`, Admin → Health | On |

## Not ported, and why

- Rewriting other outlets' stories, Google News as a story source (Rule 3).
- Full-article fetching through Supadata, the Wayback Machine or a browser-like User-Agent;
  RSSHub Facebook/X bridges; YouTube captions through residential proxies; civic-scraper for
  Granicus and PrimeGov (Rule 8; these hosts are now blocked in code).
- Town Brain facts injected into drafts (Rule 4); the MICRO length tier (Rule 7).
- Open-Meteo (its free API is non-commercial); the SEO keywords model call; Kyle's
  headline-only scorer.
- Paid meeting transcription (owner: no).

## Owner steps to switch on the gated items (each needs a model key)

- Writer v2: `pnpm evals --live --variant writer-v2`, `pnpm evals:compare`; then set
  `taskRoutes.write.promptVersion = 'v2'` and `pnpm evals --live` to record the baseline.
- Libel review: `pnpm evals --live --variant legal-review`; then remove `disabled` from
  `taskRoutes.legal` and re-record.
- Meeting splitter: `pnpm evals --live --variant meeting-split`; then remove `disabled` from
  `taskRoutes['meeting-split']` and re-record.
