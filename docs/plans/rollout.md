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

1. **Shared weather.**
   - Cache `/points` per town; it rarely changes.
   - Fetch forecasts once per NWS grid point, and alerts once per zone batch.
   - Refresh every 30 minutes.
   - Today: 4 calls per town every 15 minutes, which saturates api.weather.gov at ~225 towns.
2. **State files once per state.** Download DBPR, Sunbiz and DOR files once per run and fan the rows out to every town in the state. Today each town downloads the same statewide file.
3. **Batch launch.**
   - `pnpm launch --batch towns.csv` runs the steps for a list of approved towns.
   - The owner picks names from one combined report.
   - The domains are bought in one Rule 10 approval at a stated total price, with each domain's price shown and a typed confirmation of the total.
4. **Search Console.** Verify and submit sitemaps through the Search Console API once a Google credential exists (owner). Until then it stays a manual launch to-do.
5. **Cohort health on Admin.** Per cohort (go-live month):
   - towns, indexed vs. submitted pages, impressions, manual actions;
   - fact-check pass rate, corrections;
   - newsletter sign-ups;
   - items a day against the target (built: Admin → Health).

   The gate below shows as pass or fail.
6. **Kill switch for a whole cohort.** Built (Admin → Health).

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
