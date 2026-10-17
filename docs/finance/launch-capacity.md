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

- **Pace:** about 250 launches a month (3,000 a year) until every town is live, in FY2029.
- **Readiness:** the owner's view is that every town in America can make 3 real items a day and that Rule 7 is a target, not a gate, so the base case counts every town. The launcher code still stops a launch below the bar; turning that into a target is a Section 2 change waiting on the owner's explicit go-ahead.
- **Sales:** advertisers sign up and pay on the site, with no commission. A small partnerships team (1 person per 1,000 towns) handles regional and multi-town advertisers.
- **Review:** article review becomes an AI agent (about $0.03 a story, inside the $0.15 AI cost per story). A small editorial standards team (1 per 1,000 towns) audits the agent and handles corrections. Until the agent ships, Tier 3 stories still need a person (Rule 5).
- **Town economics:** a mature average town makes about $18k a year and contributes about $16k after its own costs, paying back in year 2.

| Towns reaching the target | Towns | FY2031 revenue | FY2031 EBITDA | Run-rate EBITDA | Equity needed |
| --- | --- | --- | --- | --- | --- |
| 25% | 2,108 | $37.8M | $28.0M | $28.4M | $5.9M |
| 50% | 4,217 | $72.0M | $58.0M | $62.6M | $7.7M |
| 75% | 6,325 | $102.3M | $84.1M | $97.0M | $7.7M |
| **100% (base: every town)** | **8,433** | **$125.6M** | **$103.1M** | **$131.7M** | **$7.7M** |

**Base case:**
- EBITDA is positive from FY2028.
- A $10M raise in FY2027 covers the $7.7M low point with a buffer.
- People: about 107 at the peak, mostly support (1 per 120 towns), with 8 on launch operations.

**What the model is light on:** advertiser acquisition. Self-serve sales rely on the house ads and the $50k–700k a year of corporate marketing. If businesses don't sign up on their own, the fill rates in Assumptions (featured spots, Enhanced, newsletter and banner sell-through) are the numbers that drop.
