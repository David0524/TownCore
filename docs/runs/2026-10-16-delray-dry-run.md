# Delray Beach, FL: first launcher dry run (M7 PR F)

Date: 2026-10-16. `pnpm launch "Delray Beach, FL"`, dry run (nothing bought, sent or deployed).
Report: `docs/launches/delray-beach/launch-report.md`.

## Setup

- **Database:** a fresh local database: migrations, `towns:sync` (Boca), then `pnpm towns:rank FL --near "Boca Raton, FL" --radius 60` (Delray ranked 13th, score 0.685).
- **Approval:** Delray's candidate row was approved in that local database only, for this run. **The owner has not approved Delray in Admin → Launches**, and nothing about Delray is in `towns/`: the town YAML and theme are under `docs/launches/delray-beach/town/` for review. They move to `towns/fl/` only when the owner approves the launch.
- **No model:** `.env` has no Anthropic key. The Gemini credential this session's proxy injects was refused by Google ("API key not valid" with a placeholder key, 403 without one, also through curl). So the run used no model:
  - discovery was manual (state sources only);
  - readiness counted roundups in code;
  - the theme came from the deterministic generator (no identity research);
  - no screenshot review.
  AI cost: $0.
- **Screenshots:** the web app (`next start`) ran against the same database, with `--site http://localhost:3200`.

## Commands

```
pnpm launch "Delray Beach, FL" --short-name Delray --preview
pnpm launch "Delray Beach, FL" --resume --pick 1 --preview
pnpm launch "Delray Beach, FL" --resume --preview --site http://localhost:3200 --chromium /opt/pw-browsers/chromium
pnpm launch "Delray Beach, FL" --resume --preview --redo theme --site … (re-taken after two fixes, below)
```

## Results by step

1. **Resolve:** Census ID 1217100, Palm Beach County, 69,809 people (tier mid), America/New_York, NWS zone FLZ068 (MFL). FLZ068 is the inland zone; Boca uses the coastal FLZ168. Check this before going live.
2. **Names** (live Vercel search, Verisign RDAP):
   - The Delray Ledger (delrayledger.com, $11.25) and Delray Courier (delraycourier.com, $11.25) are clear.
   - Delray Daily and Delray Local are ruled out: their domains are taken.
   - Town Square was skipped: Boca, 6 miles away, uses that pattern.
   - Picked: 1, The Delray Ledger.
   - The Internet Archive didn't answer from Node in the run, so the report marks the archive history "not checked". A later check through the session proxy found one capture of delrayledger.com (2024-09-13), a domain-parking redirect (`/lander`), not a news site.
3. **Sources:**
   - The three Florida state sources verified live (DBPR licenses, DBPR new food approvals, Sunbiz filings).
   - **Delray's city site refuses our bot:** `www.delraybeachfl.gov` answers HTTP 403 from its CDN for every path, robots.txt included. Its agendas, news and police releases can't be read, and we don't work around that (Rule 8).
4. **Adapters:** the town YAML has those three sources plus NWS. No adapter requests: nothing readable was unknown.
5. **Readiness: 0.2 real items a day, against 3 needed (Rule 7: fail).**
   - Sunbiz: 40 filings in 4 weeks (4 roundups).
   - DBPR new food: 3 approvals in 2 weeks.
   - DBPR licenses: 0 new in the window.
   - The run went on only because of `--preview`; the town can't go live with this score, and go-live re-checks it.
6. **Seed:** 441 active directory listings from DBPR, and one roundup published on the draft site ("New businesses registered with a Delray Beach address, Oct. 5–Oct. 11"). No guide topics are mapped yet.
6b. **Theme:**
   - Fewer than 5 items a day, so the community family: olive green #45600F (its hue chosen away from Boca's blue), sailboat motif, tinted-bar header.
   - Contrast, slot contract and neighbor rule pass.
   - Screenshots and identity assets rendered with the town's fonts.
7. **Provision (dry run):** Stripe test prices for enhanced ($39) and sponsored slot ($199) to create; mail domain not onboarded; newsletter off.
8. **Report:** every check passes except readiness. 14 manual to-dos, also logged in `docs/launch-friction.md`.

## Fixed during the run

- **Stale screenshots:** the web app caches each town for 60 seconds, so the first screenshots showed the network default theme. Capture now waits until the page shows the new theme (family and brand color). `--redo theme` re-takes screenshots and keeps the theme already made.
- **Wrong font on assets:** identity assets were drawn in a fallback serif, because replacing the page dropped the element that defines `--font-headline`. The assets now name the headline face the page actually resolved.

## What Delray needs before it can launch

- Official sources the bot may read: at least 3 real items a day (Rule 7). The city site is closed to us. Options for the owner:
  - ask the city about access for TownCoreBot (owner's call; 2026-10-15 said no per-city permission letters);
  - find other official sources (county, school district, CRA) and build adapters for them;
  - choose another town from the ranking.
- A model key, so discovery searches the web and the theme gets identity notes and a screenshot review.
- Everything in the report's manual to-dos (domain purchase, mail domain, deploy, trademark and social checks).
