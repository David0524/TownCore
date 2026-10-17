# Launch capacity (2026-10-17)

The plan (owner, 2026-10-17): launch in every US town with more than 2,000 people. Naming is not a
limit. This note covers how many towns that is, how fast they can launch, and what still has to be
true. The long-range plan (`TownCore-LRP.xlsx`) uses these numbers.

## How many towns

**8,433 towns** (Census Vintage 2025, `sub-est2025.csv`):

- 7,683 incorporated places over 2,000 people (SUMLEV 162). Florida has 295.
- 750 New England towns: active county subdivisions with no place of their own.

By our tiers:

| Tier | Population | Towns | Average households |
| --- | --- | --- | --- |
| Small | under 30,000 | 7,067 (84%) | ~3,300 |
| Mid | 30,000–100,000 | 1,023 | ~21,000 |
| Large | 100,000+ | 343 | ~70,000, with each town capped at 300,000 people |

## Naming: settled

- 22 name patterns.
- A pattern used by a town within 50 miles is offered last instead of ruled out, so naming never stops a launch.
- Domains aren't scarce. RDAP on 2026-10-17: 29 of the 30 top-ranked Florida towns have a free .com in our patterns, at about $11–20 each.

## What still has to be true

| Item | Today | What it takes |
| --- | --- | --- |
| **Readiness (Rule 7)** | The target is 3 real items a day, or 10 for a large town. Boca makes ~0.8 a day (in 30 days: 5 city releases plus ~19 weekly roundups); Delray makes 0.53. | More sources per town: permits, police and fire feeds, property sales, schools, sports, more meeting platforms. Small towns, 84% of the list, need the most. |
| **Shared data hosts** (1 request a second each) | The weather tile calls api.weather.gov 4 times every 15 minutes per town, which saturates it at ~225 towns. DBPR and Sunbiz state files are downloaded once per town. | Share weather by NWS grid point and zone, cache `/points` and refresh every 30 minutes. Ingest each state file once per state and fan it out to towns. Engineering, days. |
| **Hosting** | The demo is on Vercel Hobby: 50 domains a project, 100 deployments a day. | Vercel Pro: 100,000 domains a project (soft limit). |
| **Domains** | No registrant contact or Vercel token set yet. | Owner inputs. About $100–170k for 8,433 domains. |
| **People per launch** | ~45 minutes each: approval, Facebook page, Google Publisher Center. | At 250 launches a month, about 8 launch operators. Batch approvals and keep cutting `docs/launch-friction.md`. |
| **Pace and Google** | — | Google's scaled-content policy covers mass-produced AI pages and many sites that hide that scale. Launch in monthly cohorts and watch each cohort's indexing before speeding up. |

**Not limits:**
- AI cost: ~$0.10 a story at current pricing.
- Newsletter warm-up: each domain doubles from 50 a day every 3 days.
- Anthropic and SES quotas: raised on request.

## The plan

**Bootstrapped (owner, 2026-10-17):** about $5k of cash, no outside money, and founders take no salary at any point. Cash sets the pace, not launch capacity. The LRP's Monthly sheet launches each month only what last month's cash allows: it keeps a $1,000 floor and 4 months of fixed costs and paid staff, and it holds each young town's remaining burn until that town pays its own way (about $25 to launch: the domain, plus API discovery once it's paid; about $70 with the first months' costs). It also launches nothing while needed town work is unpaid. Staff are hired out of revenue: needed work beyond 2 FTE of founder time is paid up to 40% of last month's revenue, never more than last month's profit before staff. There is no paid launch seeding or paid subscriber acquisition.

**Costs (owner, 2026-10-17):** Boca launched on the Claude plan, a domain, Amazon and minor expenses. Claude is covered for a year by the Anthropic startup program, so AI costs nothing in FY2027 (assumed to cover API use). Every town runs on one Vercel app, one worker and one database, so a town adds about $2 a month of hosting; the shared plans are a fixed ~$75 a month (Vercel Pro, Railway, SES and AWS, small subscriptions; estimates until replaced with the bills). AI from FY2028 is $0.15 a story plus $0.05 a day of overhead (`pnpm ai:plan` puts Boca at about $0.05 a day today).

- **Readiness:** the owner's view is that every town in America can make 3 real items a day and that Rule 7 is a target, not a gate, so the base case counts every town.
- **Sales:** advertisers sign up and pay on the site, with no commission. A small partnerships team (1 person per 1,000 towns) handles regional and multi-town advertisers once revenue pays for it.
- **Review:** article review becomes an AI agent (about $0.03 a story, inside the $0.15 AI cost per story). A small editorial standards team (1 per 1,000 towns) audits the agent and handles corrections. Until the agent ships, Tier 3 stories still need a person (Rule 5).
- **Town economics:** a mature average town makes about $18k a year and contributes about $16k after its own costs. A new town's revenue starts at zero and ramps through its first year (free trials, no audience yet).

| Fiscal year | 2027 | 2028 | 2029 | 2030 | 2031 |
| --- | --- | --- | --- | --- | --- |
| Live towns (year end) | 476 | 1,357 | 3,570 | 6,230 | 8,151 |
| Revenue | $158k | $1.69M | $7.21M | $21.4M | $48.0M |
| EBITDA | $71k | $696k | $3.38M | $12.5M | $34.0M |
| Lowest month-end cash | $3.1k | $55k | $560k | $3.1M | $13.1M |
| Paid staff (FTE, year end) | 2.0 | 13.0 | 45.4 | 75.9 | 92.2 |

- Cash never goes below zero; the low point is about $3,100, in month 2 of FY2027.
- **Downside scenario** (launches x0.6, audience x0.7, monetization x0.7, unit costs x1.2): about 306 live towns at the end of FY2027 and 4,898 in FY2031, with $16.0M of revenue that year.
- The earlier plan (3,000 launches a year, $1,500 of paid seeding a launch, 45 hires in FY2027 and a $10M raise) is replaced.

**What the model is light on:** revenue per town. Boca has no paying customers yet (Stripe is in test mode), so the Age 1 fill and conversion rates in Assumptions are estimates, and the bootstrapped pace depends on them almost entirely: with costs this low, people (founder time and the support staff revenue pays for) and revenue per town now set the pace more than cash does. Measure them on the first cohorts and replace the estimates.
