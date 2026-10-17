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
| **Readiness (Rule 7)** | The bar is 3 real items a day, or 10 for a large town. Boca makes ~0.8 a day (in 30 days: 5 city releases plus ~19 weekly roundups); Delray makes 0.53. Almost no town passes. | Many more sources per town (permits, police and fire feeds, property sales, schools, sports, more meeting platforms), a lower bar, or both. The bar is a Section 2 rule, so it's the owner's call. Small towns (84% of the list) are where this bites. |
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

- **Pace:** ~250 launches a month (3,000 a year) until every town that passes readiness is live.
- **Town economics:** a mature average town makes ~$18k a year and contributes ~$11k after its own costs, with payback in year 4. That's thinner than before, because most towns are small.

| Towns passing readiness | Towns | Launch years | FY2031 revenue | FY2031 EBITDA | Run-rate EBITDA | Equity needed |
| --- | --- | --- | --- | --- | --- | --- |
| 25% | 2,108 | FY2027 | $37.8M | $15.4M | $17.2M | $20.5M |
| 50% | 4,217 | FY2027–28 | $72.0M | $33.1M | $40.1M | $33.4M |
| 75% | 6,325 | FY2027–29 | $102.3M | $47.0M | $63.1M | $42.6M |
| **100% (base: every town)** | **8,433** | **FY2027–29** | **$125.6M** | **$54.0M** | **$86.3M** | **$52.8M** |

**Base case:**
- EBITDA turns positive in FY2030.
- Raises of $25M (FY2027) and $35M (FY2028) keep cash positive throughout.
- At 554 people in FY2031, most of the cost is editors, salespeople and support hired per town at ratios set for bigger towns. Sizing those by tier (fewer people for the small towns) is the biggest lever on the funding needed.
