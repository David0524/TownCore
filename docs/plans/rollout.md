# Rollout: 3,000 towns, November 2026 – December 2027 (owner, 2026-10-17)

The goal is 3,000 live towns by the end of 2027, launched in monthly cohorts. Each cohort has to
show healthy results before the next one goes out. Google safety comes first. Related: the
long-range plan (`docs/finance/`), the launch limits (`docs/finance/launch-capacity.md`) and
`docs/plans/google-safety.md`.

## Phase 0: pilot readiness (by Nov. 1, 2026)

| Item | State | Who |
| --- | --- | --- |
| Thin pages `noindex`; TownCore as `parentOrganization`; "How we report" on every article; kill switch for a town or a cohort | Done (David0524/TownCore#103) | — |
| Rule 7 as a target: the gap is reported, the launch never stops on it | Done (David0524/TownCore#103) | — |
| Vercel Pro (Hobby allows only 50 domains and 100 deploys a day) | Waiting | Owner |
| Worker on Railway; Postgres backups, point-in-time recovery and a nightly dump | Waiting | Owner gives access; Claude deploys |
| SES production access, and AWS access to deploy the mail stack | Waiting | Owner |
| Anthropic API key (writer, fact-check, discovery) | Waiting | Owner |
| Domain registrant contact and a Vercel token | Waiting | Owner |
| Search Console verified on every pilot domain | Manual launch to-do | Staff |
| `YOUTUBE_API_KEY`, so board meeting videos become recaps | Waiting | Owner |

## Phase 1: scale readiness (by Feb. 2027, before cohorts pass ~200 towns)

1. **Shared weather. Built.**
   - Snapshots keep the next 36 hours, and the site picks the current hour at view time.
   - Alerts are fetched for every zone each run, 50 zones per request.
   - Forecasts are fetched oldest-first, at most 500 per 15-minute run, reusing the cached grid point. That's one request per town.
   - Total: about 50,000 requests a day at 3,000 towns (each forecast refreshed about every 1.5 hours) and about 53,000 at 8,433 (about every 4.2 hours), within api.weather.gov's 86,400 at 1 per second. Before, it would have been about 1.15 million a day at 3,000 towns.
   - Refresh-on-view stays off wherever the worker runs.
2. **State files once per state. Built.**
   - The Fetcher keeps one copy of each statewide file (`packages/adapters/src/http/shared-files.ts`), re-checked with a conditional GET after its window: 6 hours for DBPR, a week for a Sunbiz day file.
   - Each town's source reads its own city's rows, with its own run record and health.
   - 295 Florida towns: each file goes from 295 downloads a run to about 4 checks a day.
   - The worker needs a few hundred MB of disk for the copies.
3. **Batch launch.**
   - `pnpm launch --batch towns.csv` runs the steps for a list of approved towns.
   - The owner picks names from one combined report.
   - The domains are bought in one Rule 10 approval at a stated total price, with each domain's price shown and a typed confirmation of the total.
   - That approval also covers each domain's mail onboarding (launch step 2b), so warm-up starts the moment the domains are ours. Buy each cohort's domains at least 21 days before its go-live month (`pnpm launch --cohort YYYY-MM`); `pnpm mail:onboard bought --execute` catches up any left behind.
4. **Search Console.** Verify and submit sitemaps through the Search Console API once a Google credential exists (owner). Until then it stays a manual launch to-do.
5. **Cohort health on Admin.** Per cohort (go-live month):
   - towns, indexed vs. submitted pages, impressions, manual actions;
   - fact-check pass rate, corrections;
   - newsletter sign-ups;
   - items a day against the target (built: Admin → Health).

   The gate below shows as pass or fail.
6. **Kill switch for a whole cohort.** Built (Admin → Health).
7. **County source registry.** Built for property sales; permits next.
   - Each county's verified data sets live in `counties/<state>/<county>.yaml`. Each entry records:
     - the platform, URL and column roles;
     - the columns fetched (never owners' names or mailing addresses);
     - a city-limits method (parcel municipality codes, or a true jurisdiction column; never a mailing city);
     - the verification date and robots.txt verdict.
   - Towns list `county_sources: [property_sales]` and get the county's source with their own city-limits filter. Boca moved onto Palm Beach County's entry with an unchanged source key.
   - Launch step 3:
     - **County in the registry:** health-checks each data set for the town. A town with no verified municipality code gets a to-do.
     - **County not in the registry:** searches ArcGIS Online and the Socrata Discovery API, keeping only data sets that name the county, and scores them by column names. The best one becomes `county-draft.yaml`, with a launch to-do for a person to confirm it into `counties/`.
   - Broward's catalogs have sale dates but no prices (deed stamps only), so nothing is drafted there yet. The to-do lists the near misses.

## Monthly ramp

| Month | Launches | Cumulative | Focus |
| --- | --- | --- | --- |
| Nov 2026 | 10 | 10 | Pilot: the largest Florida towns |
| Dec 2026 | 30 | 40 | Pilot: Florida |
| Jan 2027 | 60 | 100 | Florida |
| Feb 2027 | 100 | 200 | Florida; shared sources must be live |
| Mar 2027 | 150 | 350 | Florida's last ~95, then the first next state |
| Apr 2027 | 200 | 550 | First states with shared state data |
| May 2027 | 250 | 800 | National, state by state |
| Jun 2027 | 300 | 1,100 | National |
| Jul–Nov 2027 | 350 a month | 2,850 | National |
| Dec 2027 | 150 | 3,000 | National |

Florida has 295 towns over 2,000 people (Census 2025). That's why March reaches past Florida.

## The gate between cohorts

The next cohort goes out only when the last one shows all of these:

- zero manual actions;
- healthy indexing and rising impressions;
- a steady fact-check pass rate and few corrections;
- newsletter sign-ups coming in.

If a cohort is unhealthy: pause launches, use the kill switch if needed, fix the cause, then resume.

"Sign-ups coming in" is read on Admin → Health → Audience and revenue → By cohort (built 2026-10-17): active subscribers per 1,000 households (Census ACS B11001, filled by `pnpm towns:households`), sign-ups by prompt, story views by source, claim rate, trial starts, trial to paid and revenue per town, with the same numbers by meeting platform and state. Where a number is weak the table says where to look: low claims → discovery; trials not converting → proof reports and lead flow; low traffic → content and the newsletter. Experiments (copy, prompt placement, proof-report wording, sign-up box first on phones) are assigned per town or cohort and compared on the same page; a winner rolls out to every town.

## Launch order

- **By state:** Florida first. Then the states where one state-level source serves every town (licenses, business filings, sales, inspections).
- **Within a state:**
  1. Towns on meeting platforms we already read (Legistar, CivicClerk, CivicPlus, eScribe), since they start with more stories.
  2. Then by size, largest first.
  3. Keep clusters together, so towns share county sources and Facebook audiences.

## Content, alongside the ramp

- Get Boca to 3+ real items a day, then make every source work for all towns on its platform. Order: permits, police and fire, property sales, all boards' meetings, schools, sports, business, government, community calendars.
- Never pad (Rule 7).
- No near-duplicate guides or roundups across towns.

## People and cost

- **Launch operators:** ~45 minutes a launch, or ~33 launches a month per person. That's 11 at 350 a month, fewer once approvals and Facebook pages are batched.
- **Domains:** ~$35–60k for 3,000.
- **AI:** ~$25 a launch plus ~$0.15 a story.

The LRP's base case launches 3,000 towns a year, which matches this ramp's 2027.
