# Launch capacity (2026-10-17)

How many towns TownCore can launch, how fast, and what limits it. Measured from the repo, the
local database and public data; the long-range plan (`TownCore-LRP.xlsx`) uses these numbers.

## How many towns exist

- **4,901** US incorporated places with 5,000+ people (Census Vintage 2025, `sub-est2025.csv`,
  SUMLEV 162); **229** in Florida. New England towns are county subdivisions and aren't counted.
- By our tiers: 3,535 small (under 30,000), 1,023 mid, 343 large.

## The limits, in order

| Limit | Today | What it allows | Fix |
| --- | --- | --- | --- |
| **Readiness (Rule 7)** | Boca: ~0.8 real items a day against a bar of 10 (5 city releases + ~19 weekly roundups in 30 days). Delray: 0.53 against 3. | Almost no town passes, Boca included. | More sources per town (permits, police and fire feeds, property sales, schools, sports, meeting platforms) and/or a lower bar. The bar is a Section 2 rule: owner's call. |
| **Naming neighbor rule** | 22 patterns (was 6). | 74% of places (3,636; Florida 185). Was 41%. | Done 2026-10-17. |
| **Shared data hosts at 1 request a second** | The weather tile makes 4 calls to api.weather.gov every 15 minutes per town; DBPR and Sunbiz state files are downloaded once per town. | ~225 towns before api.weather.gov is saturated (86,400 calls a day). | Share weather by NWS grid point and zone, refresh every 30 minutes, cache `/points`; ingest state files once per state and fan out to towns. Engineering, days. |
| **Hosting** | The demo is on Vercel Hobby (50 domains per project). | 50 towns. | Vercel Pro: 100,000 domains per project (soft limit). |
| **Domains** | Registrant contact and Vercel token not set. | — | 29 of the 30 top-ranked Florida towns have a free .com in our patterns (RDAP, 2026-10-17); about $11–20 each. |
| **People per launch** | ~45 minutes: approval, Facebook page, Google Publisher Center. | ~400 launches a year per operator. | Batch approvals; keep driving `docs/launch-friction.md` to zero. |
| **Pace and Google** | — | — | Google's scaled-content policy covers mass-produced AI pages and many sites hiding that scale. The plan paces launches at ~100 a month and watches indexing per cohort. |

Not limits: AI cost (about $0.10 a story on current pricing, ~2–7% of revenue), newsletter
warm-up (each domain doubles from 50 a day every 3 days), Anthropic and SES quotas (raised on
request).

## The plan

Launches each year = the smaller of the team's capacity (1,200 a year) and the towns left that
pass readiness and the naming rule. The pool is 4,901 × readiness pass rate × 74%.

| Readiness pass rate | Towns | Launch years | FY2031 revenue | FY2031 EBITDA | Run-rate EBITDA | Equity needed |
| --- | --- | --- | --- | --- | --- | --- |
| 25% | 907 | FY2027 | $19.5M | $6.3M | $7.2M | $9.8M |
| **50% (base)** | **1,813** | **FY2027–28** | **$36.8M** | **$16.3M** | **$20.1M** | **$14.7M** |
| 75% | 2,720 | FY2027–29 | $51.5M | $23.9M | $33.0M | $17.4M |
| 100% | 3,627 | FY2027–30 | $63.3M | $28.5M | $46.1M | $21.4M |

So the readiness pass rate decides the size of the business. Every source adapter that works
across many towns raises it.
