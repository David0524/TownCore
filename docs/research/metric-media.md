# Metric Media: competitive research

Researched 2026-10-17 for TownCore. Competitive research only: we do not copy or rewrite their stories (CLAUDE.md Rule 3), and their own terms forbid republishing. The goal is to learn which templated data stories run at scale, which data sets sit behind them, and why the network is called "pink slime", so TownCore stays clearly on the other side of that line.

## Method

- Published studies and reporting, found by web search on 2026-10-17 and read where they loaded: the Tow Center's 2019 and 2020 CJR pieces, NewsGuard's network profile and its 2022 and 2024 counts, Royal and Napoli's 2022 peer-reviewed study (read in full from its PDF), the Carnegie Mellon 2025 Facebook-ads preprint, and secondary coverage of the 2020 New York Times investigation. The Times article itself was not fetched (paywall); its points below come from Benton, the Boston Globe reprint and MediaWell summaries.
- One network site, `southpalmbeachtoday.com`, chosen because it covers south Palm Beach County including Boca Raton. Its `robots.txt` allows everything except `/admin`. 19 fetches in total, all with `TownCoreBot/1.0 (info@towncore.net)`, at least 2 seconds apart: robots.txt, the homepage, the sitemap index, three sitemaps (October 2026 stories, 2025 stories, Google News), About, Terms, and 12 articles picked to identify the data source of each template type.
- Samples:
  - **October 2026:** all 98 story URLs in `stories/2026-10/sitemap1.xml` (Oct. 1–16). This is the site's current output.
  - **Archive:** all 17,863 story URLs in `stories/2025/sitemap1.xml`. Their `lastmod` dates cluster in three months (Jan., June, Sept. 2025) and the stories inside are dated 2019–2025, so this is the archive re-saved during a migration, not 2025 output. Shares below are shares of the archive.
  - Categories were assigned by keyword rules on the URL slug; about 5% of the archive stayed unclassified. Treat shares as approximate.
- No other Florida network site was fetched. Their names come from Media Bias/Fact Check and NewsGuard pages.

## Who they are

- **Companies.** Metric Media LLC (created March 2019) publishes under a license from the Metric Media Foundation (a 501(c)(3), August 2019); CEO Bradley Cameron. The network is tied to Brian Timpone and his earlier companies Journatic, Locality Labs (LocalLabs), Newsinator, Franklin Archer, Record Inc. (the Record legal-news sites, owned by the U.S. Chamber Institute for Legal Reform per some About pages) and Local Government Information Services (LGIS, Illinois, with Dan Proft). Locality Labs runs shared analytics and the "Local Labs News Service" byline. Sources: [Tow Center 2019](https://www.cjr.org/tow_center_reports/hundreds-of-pink-slime-local-news-outlets-are-distributing-algorithmic-stories-conservative-talking-points.php), [NewsGuard](https://www.newsguardtech.com/metric-media-network/), [Benton summary of NYT 2020](https://www.benton.org/headlines/local-news-dies-pay-play-network-rises-its-place).
- **"Pierce Publishing"** did not turn up in any source we found. Unverified.
- **Size over time:**

| Date | Count | Source |
| --- | --- | --- |
| Dec. 2019 | 450+ sites in 5 operations; 189 Metric Media sites in 10 states | [Tow Center 2019](https://www.cjr.org/tow_center_reports/hundreds-of-pink-slime-local-news-outlets-are-distributing-algorithmic-stories-conservative-talking-points.php) |
| Aug. 2020 | 1,200+ sites; Metric Media 960+ (80%), 700+ of them activated in 2020; 49 states | [CJR 2020](https://www.cjr.org/analysis/as-election-looms-a-network-of-mysterious-pink-slime-local-news-outlets-nearly-triples-in-size.php) |
| Oct. 2020 | "Nearly 1,300" sites in all 50 states | [NYT via Benton](https://www.benton.org/headlines/local-news-dies-pay-play-network-rises-its-place) |
| Nov. 2020 – Feb. 2021 | 999 Metric Media outlets scraped daily | [Royal and Napoli 2022](https://dewitt.sanford.duke.edu/wp-content/uploads/sites/3/2022/02/Local-Journalism-Without-Journalists-ICA-submission.pdf) |
| Nov. 2022 | 1,202 partisan "pink slime" outlets in all networks | [NewsGuard](https://www.newsguardtech.com/?p=21412) |
| June 2024 | 1,265 pink slime outlets, more than the 1,213 U.S. daily newspapers; Metric Media 1,079 of them | [NewsGuard 2024](https://www.newsguardtech.com/press/partisan-funded-websites-nearly-outnumber-daily-newspapers-in-us/), [Axios](https://www.axios.com/2024/06/11/partisan-news-websites-dark-money) |

## 1. What they publish at scale

### Quantified studies

- **Tow Center, 2019:** over two weeks, 189 Metric Media sites carried more than 15,000 unique stories (over 50,000 counting each site's copy). Only about 100 had a human byline (about 0.7%). The rest were credited to "Metric Media News Service", "Local Labs News Service" or "Press Release Submission". [CJR](https://www.cjr.org/tow_center_reports/hundreds-of-pink-slime-local-news-outlets-are-distributing-algorithmic-stories-conservative-talking-points.php)
- **CJR, 2020:** "over 90 percent" of Metric Media and Franklin Archer stories are algorithmic, built from public data sets or repurposed from other outlets. One story ran with different stock photos on more than 850 domains. [CJR](https://www.cjr.org/analysis/as-election-looms-a-network-of-mysterious-pink-slime-local-news-outlets-nearly-triples-in-size.php)
- **Royal and Napoli, *Journal of Creative Industries and Cultural Studies* vol. 8, 2022** (Duke; scraped Nov. 16, 2020 – Feb. 1, 2021; [PDF](https://dewitt.sanford.duke.edu/wp-content/uploads/sites/3/2022/02/Local-Journalism-Without-Journalists-ICA-submission.pdf), [summary](https://whatworks.news/2021/07/12/fake-news-duke-researchers-tally-up-pink-slime-stories-at-metric-media/)):
  - About 217,000 unique articles in 78 days; **97% autogenerated**. Each template ("strain") was near-identical across outlets (mean Jaccard similarity 0.92 after removing names).
  - About 2,500 stories were press releases reproduced word for word ("Press Release Submission").
  - The local gas-price strain alone ran more than 20,000 times.
  - Only 1.31% of autogenerated stories reached any front page; two partisan strains (a Biden tax-rate template and Cato governor grades) were 0.43% of autogenerated stories but 64% of autogenerated front-page appearances.
  - Only 4,216 stories were human-written, by 161 authors writing for outlets in a median 9.5 states.
  - Nearly two-thirds of outlets published no human-written story in 78 days. Median age of front-page stories: 81 days. Only 97 of 999 outlets had three or more stories under two weeks old on their front page.
  - State "hub" sites (5% of outlets) originated about 43–45% of front-page content.
  - Georgia outlets ran 102 human-written stories in the 2020 runoff period, 78% about electoral fraud; output then fell 95%.
- **Category shares by template type** were not published by any study we found. Our own count of one site's archive is below.

### One site's archive: South Palm Beach Today (17,863 story URLs, mostly 2019–2025)

| Template family | Count | Share |
| --- | ---: | ---: |
| Gas prices by ZIP code or city (regular, midgrade, premium, diesel, E85; "best station") | 3,009 | 17% |
| Home sales naming buyer and seller | 2,773 | 16% |
| Campaign contributions naming the individual donor | 2,445 | 14% |
| Junior tennis rankings naming individual players (children) | 2,243 | 13% |
| Former high-school athletes' college games, named | 2,164 | 12% |
| VA appointment and wait-time counts by facility (statewide) | 1,014 | 6% |
| A congresswoman's tweets and releases | 804 | 5% |
| Census ACS, County Business Patterns, SSA beneficiaries, IRS migration | 738 | 4% |
| City and organization announcements, closures, events (reposted) | 644 | 4% |
| Congressional Record items and Florida lobbyist registrations | 391 | 2% |
| School stories, mostly a "no new teachers signed a pledge to teach critical race theory" series | 319 | 2% |
| Catholic Mass times | 223 | 1% |
| Health and safety data (COVID, FDA citations, CMS nursing homes) | 147 | 1% |
| Other: H-1B petitions, HUD housing, SNAP shares, "local doctor says" health pieces, gift guides | about 970 | 5% |

About 80% of the archive is one of five templates, and about 55% names a private individual (home buyers and sellers, donors, child tennis players, young athletes).

### The same site now (98 stories, Oct. 1–16, 2026)

| Type | Count |
| --- | ---: |
| Meeting recaps: county Planning and Zoning commissions, County Commission, Solid Waste Authority, Boynton Beach, Highland Beach and South Palm Beach boards | 49 |
| Florida Atlantic University athletics, rewritten from the athletics department | 33 |
| Rep. Lois Frankel's social-media posts | 6 |
| "Which former high-school stars compete today", named | 5 |
| Federal data: USCIS H-1B petitions by industry (2), IPEDS college enrollment (1) | 3 |
| PBSO request for help in a homicide | 1 |
| County nutrition program | 1 |

- The current mix looks AI-written rather than template-filled: meeting stories with quotes, votes and section subheads ("THE PLAN", "BOARD REACTION"), bylined "South Palm Beach Today Staff Reports". One Solid Waste Authority meeting on Oct. 14 produced **10 stories**, at least 4 of them on the same NEFCO contract vote with near-identical headlines. The story pages did not link the agenda, minutes or video.
- Images on new stories come from `attachments.galewood.ai`; archive images from CloudFront and `cdn.metricmedianews.com`. We did not research Galewood.
- The archive templates (gas, home sales, donors, tennis) no longer appear in October 2026.

### Headline templates seen (paraphrased patterns)

From the studies and the one site (headline level only):

- `Gas prices near ZIP code {zip} for the week of {dates}`; `Best station to purchase {grade} gas near ZIP code {zip}`; `Where were the cheapest places to fill up on {grade} gas in cities in {county} in week ending {date}`.
- `{Buyer} acquires {address}, {city} for ${price}`; `{Seller} sells / unloads {address}`; `Top 100 {city} home sales for {month}`; `{city} had a median home sale price of ${x} of {n} homes in {month}`.
- `{Candidate}'s campaign committee receives ${x} from {donor}`; `{Employer} employee {donor} contributes a total of ${x} to {party} candidate {candidate}`; `{Committee} refunded ${x} in {year}`.
- `How high did {town} junior tennis player {name} rank in Boys' {age} bracket in week ending {date}?`; `On {date}, former {high school} standout {name}'s college team won in an NCAA {division} {sport} game`.
- `VA reports {increase|decrease} in number of appointments at {facility} in {month}`.
- `{n} {industry} businesses in {county} have between one and four employees in {year}`; `Census Bureau: {x} percent of people in {place} {statistic} in {year}`; `{x}% of households in {place} received food stamps in {year}`.
- `{n} H-1B petitions filed by employers classified under {industry} across {site} publication area in {year}`.
- `{Facility} was {rank} largest nursing home in {county} as of {quarter}`; `Who owned {nursing home} in {quarter}?`
- `FDA: {n} companies in cities within {county} received {n} citations in {quarter}`.
- `{n} lobbyists register in {state} to represent principals from {state} during {year}`; `Public bills and resolutions published by Congressional Record ... on {date}`.
- `What did {member of Congress} just tweet?`; `{Official} highlights {topics} in recent posts`.
- `{County} COVID-19 update: {x}% of infected residents alive as of {date}`; `{n} deaths from {cause} in {state} during week ending {date}`.
- `{n} professional licenses were issued in {city} during week ending {date}`; `{Name} earns ${x} in compensation from {county} in {year}`; `{jail} has an inmate population of at least {n}`; `{district} had {n} seventh-grade students during {year}` (Royal and Napoli examples).
- Partisan strains: `Top marginal tax rate in {state} could reach {x}% under Biden plan`; Cato governor grades; Heritage Foundation "voter fraud cases" counts; `No new teachers in {town} sign pledge on {date} to teach critical race theory`.
- `{Area} weekly Mass times`.

Not found in any source or in our sample: PPP-loan, unemployment (LAUS), building-permit, OSHA, EPA or sex-offender templates. Weather by ZIP is mentioned by the CMU preprint. Absence in our sample doesn't prove they never ran.

## 2. Data behind each template

| Template | Dataset and publisher, as cited in the stories | Public or commercial |
| --- | --- | --- |
| Gas prices by ZIP and "best station" | GasBuddy.com (credited in the story) | **Commercial**, crowd-sourced, terms restrict reuse |
| Home sales with names | BlockShopper.com ("This story was found on BlockShopper.com"), which compiles the county clerk's deed records | **Commercial** aggregator of public deeds |
| Median home sale prices, "top 100 home sales" | Unstated; likely the same aggregator | Unclear |
| Federal campaign contributions | Federal Election Commission (FEC) | Public |
| Junior tennis rankings | United States Tennis Association rankings | Private association data about minors |
| College games of former high-school athletes | College athletics sites and rosters (inferred) | Private |
| VA appointments and wait times | U.S. Department of Veterans Affairs access data | Public |
| Census and business counts | Census Bureau (ACS, County Business Patterns, manufacturing reports), SSA OASDI by ZIP, IRS migration | Public |
| H-1B petitions | USCIS H-1B Employer Data Hub (credited) | Public |
| College enrollment | NCES IPEDS (inferred from "fall 2024 undergraduates") | Public |
| Nursing-home size, rating, ownership | CMS (credited) | Public |
| FDA citations | FDA inspection and citation data (credited) | Public |
| Lobbyist registrations | Florida Legislature lobbyist registration data (inferred) | Public |
| Congressional Record | Congress.gov / GovInfo | Public |
| COVID and deaths by week | CDC, NCHS, state health department | Public |
| Officials' tweets | X/Twitter posts of the official | Social media, not a record |
| Mass times | Diocesan schedules or a Mass-times directory | Private listings |
| Partisan strains | Heritage Foundation, Cato Institute, Tax Foundation, Zinn Education Project pledge list | Advocacy organizations, not public records |
| Meeting recaps (2026) | County and city meetings, likely video or minutes (not linked) | Public |
| FAU sports (2026) | FAU athletics department releases | Press releases |
| Press releases | "Press Release Submission" | Paid or submitted PR |

## 3. Volume and mix

- **Per site per day.**
  - Tow 2019: about 50,000 site-copies in 14 days across 189 sites, roughly **19 stories per site per day**, almost all shared templates.
  - Royal and Napoli: about 217,000 unique articles across 999 outlets in 78 days, about 2.8 unique per outlet per day, with the same templates repeated across many outlets.
  - South Palm Beach Today, October 2026: 98 stories in 16 days, **about 6 a day**, in bursts (26 on Oct. 8, 16 on Oct. 10, 2 on Oct. 12).
- **Templated vs. other.** 90–97% templated in 2019–2021 (studies above). Human-written stories were under 2% and skewed to state and national politics.
- **Press releases.** About 1% of stories in 2020–2021 were word-for-word press releases. In October 2026, a third of the sample is university athletics releases.
- **Paid and political.**
  - The NYT reported in 2020 that many stories were ordered by political groups and PR firms to promote a candidate or company or attack rivals, with freelancers paid about $22 a story, and that only a few dozen sites disclosed advocacy funding ([Benton](https://www.benton.org/headlines/local-news-dies-pay-play-network-rises-its-place), [Boston Globe reprint](https://www.bostonglobe.com/2020/10/19/business/local-news-dies-pay-for-play-network-rises-its-place)).
  - The Tow Center found four PACs and four nonprofits paid the network **over $14 million in 2021–2022** ([Nieman Lab](https://www.niemanlab.org/reading/the-non-profits-and-pacs-that-spent-14-million-on-the-metric-media-network-in-2021-22/)).
  - Metric Media spent about $1.93 million on Facebook and Instagram ads in 2020–2024 ([CMU preprint](https://arxiv.org/html/2510.14818v1)); Tow put it at $450,000–$1.2 million for 2021–2022 ([Boston Globe](https://www.bostonglobe.com/2024/06/26/business/pink-slime-fake-news-new-england-west-cook)). It also mailed print copies to homes before the 2022 election ([Northwestern](https://localnewsinitiative.northwestern.edu/posts/2023/03/28/pink-slime-stanford-study/index.html)).
  - In our archive sample, the "local doctor says" health pieces (a named author, a clinic-style topic) look promotional and carry no Sponsored label (inferred, not confirmed).

## 4. Criticisms and consequences

| Issue | What was found | Source |
| --- | --- | --- |
| Looks local, isn't | Same design on 1,000+ sites; generic names (direction + place + "News/Today/Times"); "imposter site" | [MBFC](https://mediabiasfactcheck.com/south-palm-beach-today/), [CJR 2020](https://www.cjr.org/analysis/as-election-looms-a-network-of-mysterious-pink-slime-local-news-outlets-nearly-triples-in-size.php) |
| Ownership and funding hidden | NewsGuard fails them on disclosing ownership and financing, separating news and opinion, labeling ads, and corrections (no policy found) | [NewsGuard](https://www.newsguardtech.com/metric-media-network/) |
| Undisclosed political payments | A PAC paid the CEO's consulting firm about $7,000 in 2020 while Georgia sites ran five stories on that race without disclosure | [NewsGuard](https://www.newsguardtech.com/metric-media-network/) |
| Our own observation today | South Palm Beach Today's About page claims "in-depth reporting" and names no owner; Terms name only the site; Metric Media appears only in hidden page metadata (`author: Metric Media News Service`). No corrections page, no methods page, no source links on meeting stories | Fetched 2026-10-17 |
| Credibility ratings | MBFC: Right-Center, Mixed factual reporting, Low credibility, Questionable (South Palm Beach Today, updated May 2025) | [MBFC](https://mediabiasfactcheck.com/south-palm-beach-today/) |
| Stale and thin | Median front-page story age 81 days; most outlets have no recent story | Royal and Napoli 2022 |
| Templated duplication | Same story on 850+ domains; 20,000 gas-price copies | CJR 2020; Royal and Napoli 2022 |
| Little audience | Low visibility in search and social; Stanford-cited work found few readers | [CJR 2020](https://www.cjr.org/analysis/as-election-looms-a-network-of-mysterious-pink-slime-local-news-outlets-nearly-triples-in-size.php), [Northwestern](https://localnewsinitiative.northwestern.edu/posts/2023/03/28/pink-slime-stanford-study/index.html) |
| Google | CJR 2020 says some partisan sites were indexed by Google News. We found **no report of a Google delisting or manual action** against the network. The site still publishes a Google News sitemap. | CJR 2020; fetched sitemap |
| Meta | NewsGuard blamed Meta's ad policies for "contributing to the deception"; pages ran as "Media/News company" | [Fortune](https://www.fortune.com/2022/10/27/meta-facebook-instagram-making-millions-political-ads-fake-pink-slime-newsrooms-newsguard/) |

Google's spam policies (scaled content abuse, site reputation) are a live risk for any templated network even without a recorded action against this one. The marks that get a network called pink slime are: hidden owner and funding, undisclosed paid or political content, the same story on hundreds of sites, partisan strains placed as news, stale front pages, and naming private people from data dumps.

## 5. Florida and Palm Beach County

- **Known Florida network sites:** South Palm Beach Today and North Palm Beach Today (Palm Beach County), North Broward News and South Broward News, North Miami-Dade News and South Miami-Dade News, Miami Courant, Palm Coast Times, Orlando Standard, plus the Florida Record (legal, Record network) and Florida Business Daily (Metro Business network, inferred from the Tow 2019 list). Windermere Today was one of 15 Florida LocalLabs sites registered in 2018 (Tow 2019). Sources: [MBFC search](https://mediabiasfactcheck.com/south-broward-news/), [NewsGuard](https://www.newsguardtech.com/metric-media-network/).
- "Sun Coast News", "Palm Beach Times" and "Boca Raton Times" were not confirmed as network sites by any source.
- **South Palm Beach Today** covers Boca Raton, Delray Beach, Boynton Beach, Lake Worth Beach, Greenacres, Wellington, Highland Beach and unincorporated south county ("South Palm Beach Today publication area").
- **Example article types from it (headline level):**
  - A county Planning Commission recommending a land-use change for a 40-bed rehab hospital, 9–0.
  - A Highland Beach code magistrate giving a named company a deadline on a permit violation.
  - Boynton Beach carrying $49 million in purchase orders into the new fiscal year.
  - The number of H-1B petitions filed by manufacturing employers in the "publication area" in 2025.
  - A Boca Raton nursing home's size and CMS rating against the county average.
  - (Archive) a named Boca Raton child's USTA ranking; a named buyer's Delray Beach home purchase; a named donor's $250 gift to a congressional candidate; weekly gas prices for ZIP 33435.

## How TownCore can get the same data itself

Status: "TownCore" means a source we already ingest. URLs marked "unverified" were not fetched in this session; check robots.txt and terms before building (Rule 8).

| Data type | Best primary public source | Access | Granularity | Cadence | Caution |
| --- | --- | --- | --- | --- | --- |
| Gas prices | U.S. EIA weekly retail gasoline prices (`api.eia.gov`, series for Florida and the Miami city average) | Documented API, free key | State, a few metro areas (Miami); no ZIP or station | Weekly (Mondays) | GasBuddy, AAA and OPIS are licensed: never use. EIA can't support "best station near {ZIP}"; a weekly state/Miami line in the Today tile or newsletter is the honest version |
| Home sales | County property appraiser sales (PBC `pbcpao.gov`) and Florida DOR NAL/SDF files (approved backfill, 2026-10-16) | Bulk files; PBC CAMA twice a year, DOR yearly; current sales by data request | Parcel, rolled up to town and ZIP | Twice yearly to yearly; monthly by request | BlockShopper, Zillow, Realtor.com and MLS data are commercial. **Never name private buyers or sellers.** Report counts, medians and notable non-residential sales by address range or block |
| Federal campaign finance | FEC API (`api.open.fec.gov`) | Documented API, api.data.gov key | Candidate, committee; donor ZIP | Daily | **Never name individual donors** (private people, §7 Tier 3). Report totals by candidate, share from in-town ZIPs, committee spending |
| State and local campaign finance | Florida Division of Elections campaign finance database; county Supervisor of Elections for local races | Bulk download/query (unverified; `votepalmbeach.gov` returned 403 to us on 2026-10-16) | Candidate | Per reporting period | Same as above: totals only |
| Federal spending | USASpending API (`api.usaspending.gov`) | Documented API, no key | Recipient place, ZIP, county | Daily | Name businesses and governments, not individuals (sole proprietors are people) |
| PPP and SBA loans | SBA FOIA PPP data (`data.sba.gov`) | Bulk CSV | Borrower ZIP and city | Static (program ended) | Mostly old news; borrowers can be sole proprietors, so aggregate |
| Unemployment and jobs | BLS LAUS (`api.bls.gov`) and FloridaCommerce LMS; BLS QCEW for county wages | Documented API, free key | County; cities over 25,000 | Monthly (LAUS), quarterly (QCEW) | None; good Tier 1 template |
| Building permits | Census Building Permits Survey (place-level files on `www2.census.gov`, already on our allowlist); city permit systems where open | Bulk files | Permit-issuing place | Monthly | City systems vary (Boca's eHub has no free bulk feed) |
| Demographics and business counts | Census ACS API (`api.census.gov`), County/ZIP Business Patterns (bulk on `www2.census.gov`) | Documented API (key optional), bulk files | Place, ZIP, county | Yearly | Don't publish one-statistic stories ("x% were old enough to vote"); fold into guides and entity pages (near-duplicate guard) |
| Schools | NCES Common Core of Data and IPEDS; Florida DOE school grades | Bulk files; FLDOE returned 403 to us | School, district, college | Yearly | Never name students. FLDOE needs another host |
| Nursing homes and hospitals | CMS Provider Data Catalog (`data.cms.gov`, Nursing Home Care Compare, ownership file) | Documented API, no key | Facility | Monthly | Inspection deficiencies are accusatory: Tier 3. Never name residents |
| Restaurant inspections | Florida DBPR inspection extracts | Bulk CSV | Establishment | Weekly | TownCore (live). Failures Tier 3 |
| Business licenses and filings | Florida DBPR licenses; Sunbiz daily files | Bulk files | Business, mailing city | Daily | TownCore (live). Mailing city isn't city limits |
| FDA citations | FDA Data Dashboard (`datadashboard.fda.gov`) | Download; API needs registration (unverified) | Firm, city | Quarterly | Accusatory: Tier 3; firms only |
| Workplace safety | DOL OSHA enforcement data (`enforcedata.dol.gov`) | Documented API, key | Establishment | Daily | Accusatory: Tier 3. Never name injured workers |
| Environmental compliance | EPA ECHO (`echo.epa.gov` web services) | Documented API, no key | Facility | Weekly | Tier 3 for violations |
| H-1B petitions | USCIS H-1B Employer Data Hub | Bulk CSV | Employer, city, ZIP | Yearly | Low reader value; avoid "publication area" filler |
| VA wait times | VA access-to-care data (`va.gov`) | Download (unverified) | Facility | Monthly | Only for towns with a VA facility; otherwise it's filler |
| Lobbyists | Florida Legislature lobbyist registration data | Download (unverified) | Firm, principal | Ongoing | Lobbyists are professionals in a business role; fine by name |
| Congress | Congress.gov API and GovInfo | Documented API, api.data.gov key | Member | Daily | Votes and bills from records, never an official's social posts as a story (not a record) |
| Meetings | City and county agendas, minutes and video (Legistar, CivicClerk, CivicPlus, Swagit; PBC agenda pages) | Adapters live | Body | Per meeting | TownCore (live). One story per meeting item at most, always linked to the agenda or minutes; never several near-identical stories on one vote |
| Weather | NWS API | Documented API | Forecast zone | Hourly | TownCore (live) |
| Crime | Official police releases; FBI Crime Data Explorer API for yearly agency totals | Releases; documented API, key | Agency | Per release; yearly | Tier 3. Never arrest reports without a release, never mugshots |
| Sex-offender registry | FDLE registry | Search site | Address | Ongoing | **Do not use.** Private individuals, Tier 4 territory, high harm |
| Youth sports rankings and athletes | USTA rankings, school and college rosters | Private sites | Person | Weekly | **Never.** Named minors are Tier 4; private data |
| Mass times and church notices | Parishes and dioceses | Private sites | Parish | Weekly | Out of scope; at most an events-calendar entry the organization sends |

## What this means for TownCore

How we already differ, and must keep differing:

- **Disclosure.** About and Privacy name TownCore as publisher (Rule 1), Methods explains how stories are made, Corrections exists, and every article links its source records (Rule 4). Metric Media hides its owner and links no sources.
- **No paid or political content as news.** Paid units carry the locked Sponsored label (Rule 6); no PAC, campaign or advocacy money buys stories. Keep it that way, and log it if a political advertiser ever wants a directory or newsletter slot.
- **No private people from data dumps.** About 55% of their archive named private individuals: home buyers, donors, children. Our §7 tiers block or gate all of that.
- **No near-duplicates.** The near-duplicate CI guard, rollups instead of one-statistic stories, and the "missing story beats a thin one" rule (Rule 7) answer the 20,000-copy gas story and the 10-story board meeting.
- **No commercial data.** Their two biggest templates (GasBuddy and BlockShopper) are scraped or licensed commercial data. Ours come from agency APIs and bulk files.
- **Freshness and a real front page.** Ranking, freshness decay and the noindex rule for thin pages (google-safety plan) answer the 81-day-old front pages.

Worth borrowing as clean, public-record templates (Tier 1–2, rolled up, no private names): monthly unemployment (LAUS), monthly permits (Census BPS), quarterly CMS nursing-home ratings by town, federal spending in town (USASpending), campaign totals by candidate (FEC, no donor names), and a weekly state/Miami gas line (EIA) inside weather or the newsletter rather than as its own story.

Their 2026 shift to AI-written meeting recaps from county and city boards is the closest thing to TownCore's product. The difference readers and Google can see is in the points above: a named publisher, linked sources, one story per decision, and no paid politics.
