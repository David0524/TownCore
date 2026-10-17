# Content depth: stories people open every day

Written 2026-10-17, overnight, under the owner's "do all of the above … I trust your judgement". Every decision below is Claude's call, made to be easy to revisit; the ones only the owner can make are marked **Owner**.

Research behind it:

- `docs/research/boca-news-now.md`: what Boca News Now publishes (110 posts) and where it comes from.
- `docs/research/metric-media.md`: what the Metric Media network publishes, the data behind each template, and how to get the same data from public sources.
- `docs/plans/public-data-sources.md`: a Rule 8 check (robots.txt, terms, keys, limits) of each candidate data source, with samples.

## The problem

Boca makes about 0.8 real items a day against a target of 3 (Rule 7), and most of it is weekly roundups of filings and licenses. Useful, but not something people open every morning. Small towns, 84% of the list, have fewer records still.

## What the two competitors show

| | Boca News Now | Metric Media (South Palm Beach Today) |
| --- | --- | --- |
| Volume | ~5 posts a day, every day | ~6 a day now; 17,863 archive stories |
| Original reporting | Very little: records, official statements, court filings, press releases | None: 90–97% templates, now AI meeting recaps |
| Biggest share | Public safety, 40% (arrest reports, mugshots) | Templates naming private people, ~55% (buyers, donors, child athletes) |
| What works | One named place per story ("Gary Woo Express logs 18 health code violations"); speed on weather and closures; a 30,000-reader nightly email; syndication to Apple News, NewsBreak, SmartNews, Google News | Volume and a local-sounding name |
| What we must not copy | Mugshots, arrests without a release, lawsuits from the clerk's site, loaded headlines | Hidden owner, no sources, private people's names, commercial data (GasBuddy, BlockShopper), paid political stories, many near-identical stories |

Readers reward **named, local, specific and fast**. Neither outlet does much reporting; both win on picking records people care about and getting them out quickly. Metric Media also shows what Google and the press look for in a pink-slime network; our rules already answer each point (`metric-media.md`, last section), and the near-duplicate guard is now the line we hold hardest.

## Decisions

**D-CD-1: Spotlights (built, `packages/pipeline/src/spotlights.ts`).** A record that is news on its own gets its own short story, built in code, beside the weekly roundup that still lists everything:

- an inspection with a closure order or a complaint, or at least 5 high-priority or 15 total violations: up to 3 a week, always Tier 3, with the state's violation categories (risk factors first) and the place's earlier visits;
- a permit of at least $1M estimated cost: up to 2 a week, Tier 1.

Single property sales and single new licenses are **not** spotlighted. Built for two towns, they shared 55% and 47% of their text, over the 30% near-duplicate limit: one sale has too few facts to read differently from town to town. That is exactly Metric Media's home-sales template. They stay in their weekly roundups.

**D-CD-2: Public safety stays capped, for now.** Boca News Now's 40% public safety is its engine; ours would come only from official releases (Tier 3). No safety source is live yet, so the 20% cap (§6a) doesn't bind. Boca's police and fire releases are now read from their News Flash list pages (about one a month each), and PBSO's WordPress feed is readable for county-wide releases; at that volume the cap still doesn't bind. When safety releases become a bigger share, revisit: Claude's recommendation is to keep the cap on the homepage and newsletter, and let official releases publish beyond it as their own stories. **Owner** (a §6a change).

**D-CD-3: Regional sources before more town sources.** Boca News Now covers five cities; only 31% of its posts name Boca. County and state sources serve every town in the county at once (the county registry, `counties/`). Next sources, in this order, all public and code-built, Tier 1 unless noted:

1. National Hurricane Center feeds (tropical outlooks and advisories), a templated alert like NWS.
2. Monthly jobs (BLS LAUS county unemployment): one story a month per county.
3. Monthly new-home permits (Census Building Permits Survey, place level, already on our allowlist host).
4. Federal money in town (USASpending): new contracts and grants over a threshold to local recipients, businesses and governments only.
5. Facility compliance (EPA ECHO, OSHA, CMS nursing-home inspections): Tier 3 when a story reports a violation; facilities and businesses by name, never workers, patients or residents.
6. County commission and zoning agendas (PBC), elections from the Division of Elections, school grades from a host that lets us in.
7. Campaign money (FEC, Florida Division of Elections): totals by candidate and the share from town ZIPs, **never a donor's name**.
8. Gas prices (EIA, state and Miami weekly): a line in the Today tile and newsletter, **not** a story.

Each source gets a Rule 8 check first (`public-data-sources.md`), and documented APIs go on `DOCUMENTED_APIS` with their terms URL. A monthly or quarterly data story must pass the near-duplicate guard like every template; a statistic too thin to read differently goes into guides and entity pages instead.

**D-CD-4: Never.** Sex-offender registries, youth sports rankings or rosters, named home buyers or sellers, named donors, officials' social posts as stories, commercial data (GasBuddy, AAA, BlockShopper, Zillow, MLS), arrest reports without a release, mugshots, and paid or political content presented as news.

**D-CD-5: Distribution.** Boca News Now reaches readers through a 30,000-reader email, breaking alerts and news apps. Owner paperwork, no code: Google News Publisher Center (already a launch to-do), NewsBreak's publisher program, SmartNews, Apple News. Code, later: a breaking-alert email for severe weather and road closures, sent under the town's standing newsletter approval (D-MAIL-11). **Owner** for the sign-ups.

**D-CD-6: One site per town, or one per county? Owner.** Boca News Now works because it is regional. For the 7,067 towns under 30,000 people, one site per county or cluster ("South Palm Beach County") would have more stories per site, fewer thin pages and no copies of the same county story across ten sites, the near-duplicate pattern Google looks for. One site per town keeps the local brand and the directory per town. This changes the business model (the LRP counts towns), so it is the owner's call. Claude's recommendation: keep one site per town for towns over 30,000 and test a county site in one Florida county alongside the pilot.

## Build order

1. Spotlights (D-CD-1). **Done**, with tests and the near-duplicate check.
2. USASpending: **done** (`usaspending` adapter, weekly federal awards roundup, given to every town by the launcher). Boca police and fire releases: **done** (CivicPlus `newsflash-list`; those categories aren't in the city's RSS feed). Hurricane Center: **done**, as a tropics panel on the Weather page, the Today tile and the newsletter, not a story (the same storm would be the same story on every coastal site). Next: Boca's development-projects layer (`arcgis`). BLS LAUS is deferred like Census BPS: a monthly unemployment rate reads the same from town to town, so it belongs in guides and entity pages, not stories. Census BPS is deferred: its place files are numbers only, so a monthly story wouldn't pass the near-duplicate guard; the numbers go into guides and entity pages instead.
3. CMS nursing homes: **done** (`cms` adapter, `health_facilities` source kind, a weekly roundup of what CMS's monthly release added and a spotlight for actual harm, immediate jeopardy, a payment denial or $25,000 in fines, all Tier 3, given to every town by the launcher). Next: EPA ECHO (bulk file) and OSHA (owner key), the same facility pattern. Hospital star ratings stay for explainers and guides, since a rating that changes monthly isn't a story.
4. FEC and state campaign totals, county agendas, schools.
5. The breaking-alert email.

## How we'll know it works

Items a day per town (Admin → Health), subscribers per 1,000 households, Facebook referrals, and which spotlights get shared, measured per cohort. Target: Boca at 3 or more real items a day by the end of the pilot, with every one passing the tier rules and the near-duplicate guard.
