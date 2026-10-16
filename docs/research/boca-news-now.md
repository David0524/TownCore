# Boca News Now: competitive research

Researched 2026-10-16 for TownCore. Competitive research only: we do not copy or rewrite their stories (CLAUDE.md Rule 3). The goal is to learn what Boca-area readers get and which public records sit behind it, so we can go to those records ourselves.

## Method

- `https://bocanewsnow.com/robots.txt` (Rank Math default) disallows only `/wp-admin/`, `/*?share=` and `/wp-content/uploads/wpforms/` for all agents. Everything below was allowed.
- About 35 fetches in total, all with `TownCoreBot/1.0 (info@towncore.net)`, at least 2 seconds apart: robots.txt, the sitemap index and news sitemap, the RSS feed (`/feed/`, pages 1–11), the homepage, 12 articles, and the advertising and policies pages. The site never blocked us.
- Sample: the **110 most recent posts in the RSS feed**, 2026-09-25 to 2026-10-16 (22 days). The XML sitemaps were stale (the newest entry was 2026-07-03), so the feed is the reliable sample.
- The feed carries titles, dates and tags only, with no body text. Sourcing comes from the 12 articles we read, plus what the headlines show. Anything inferred is marked as inferred.
- Search engines were used to find source URLs. Hosts we probed for robots.txt are noted.

## Who they are

- Founded in 2011, owned by MetroDesk Media, LLC. Run by Andrew Colton, a former network news correspondent (policies page). Federal trademark since 2021.
- Coverage area: Boca Raton, Delray Beach, Boynton Beach, Lake Worth Beach, Wellington, and parts of south Palm Beach and north Broward counties.
- Of the 110 headlines, 34 name Boca and 34 name another place (Delray, Boynton, Broward, the Turnpike). The rest are countywide, state or national.

## 1. What they post (110 posts, Sept. 25 – Oct. 16, 2026)

| Category | Count | Share |
| --- | ---: | ---: |
| Arrests, charges, DUI, convictions (named people) | 21 | 19% |
| Other police incidents (shootings, FBI activity, death investigations, police presence) | 10 | 9% |
| Crashes and train incidents | 11 | 10% |
| Fire and rescue | 2 | 2% |
| **Public safety subtotal** | **44** | **40%** |
| Weather and hurricanes | 15 | 14% |
| Civil lawsuits | 9 | 8% |
| County and city government (resignations, town halls, budgets, grants, spraying) | 6 | 5% |
| Development and land use (Agricultural Reserve, Islamic Center proposal) | 5 | 5% |
| Elections (dates, voting app, mail ballots, canvassing) | 5 | 5% |
| Schools and universities | 5 | 5% |
| Travel and consumer (JetBlue, lottery) | 4 | 4% |
| Community and nonprofits | 4 | 4% |
| Events | 3 | 3% |
| Road work and traffic alerts (weekly roundups) | 3 | 3% |
| Opinion columns and the outlet's own disputes | 3 | 3% |
| Restaurant health inspections | 2 | 2% |
| Code-violation list | 1 | 1% |
| Real estate (a paid "Local Journalism Supporter" post) | 1 | 1% |

**Not in the sample at all:** restaurant openings and closings, home sales, building permits, city council meeting recaps, obituaries and sports. Inspections and property stories appear in the archive (an earlier June inspection story is referenced), so these beats are irregular rather than absent.

Example headlines (headline-level references only):

- **Arrests:** "Boca Raton Woman, 21, Charged in Porsche Hit-and-Run, Found At Taco Bell"; "Boca Raton DUI Arrest: Driver Allegedly Clocked At 73 MPH On Military Trail"; "Boca Scooters Owner Arrested Again After E-Moto Wheelie In Boca Raton"; "KINGS POINT DELRAY BEACH: Three More Arrests, Now 110 Since 2023"; "BODYCAM VIDEO: Boca Raton Realtor Talkative After Arrest For Kidnap, DUI".
- **Police incidents:** "FBI CONDUCTS OPERATIONS IN SEVEN BRIDGES DELRAY BEACH"; "PURSUIT AND DEADLY SHOOTING IN WEST BOYNTON BEACH"; "GLADES ROAD AND DIXIE HIGHWAY: Boca Raton PD Large Presence"; "$5,000 Reward Offered in Unsolved 2022 North Broward Murder".
- **Crashes:** "CRITICAL CRASH: STAY AWAY FROM ATLANTIC AVENUE AND THE FLORIDA TURNPIKE"; "Serious Scooter Crash In Boca Raton Causes Big Traffic Problems"; "One Dead In Delray Beach Train Incident"; "Fiery Truck Crash Closes Florida Turnpike Near Boca Raton Early Wednesday".
- **Fire:** "Boca Raton Firefighters Battle Warehouse Blaze Overnight"; "Broward Sheriff's Deputies Rescue Three At Sea".
- **Weather:** a near-daily "HURRICANE CENTER: …" series (10 posts); "WEATHER ALERT: Flood Advisory In Effect For Southeastern Palm Beach County"; "Hot And Rainy In Boca Raton … With Real Feel Of 102".
- **Lawsuits:** "Woman Sues Boca Raton Regional Hospital Over Slippery Floor Injuries"; "Buyer Sues Mandarin Oriental Boca Raton Developer Over $1.23 Million Condo Deposit"; "LAWSUIT: Joseph's Classic Market Fired Worker Over Limited English"; "Tennis Pro Sues Boca Raton's Lotus Palm HOA Over Theft Accusation".
- **Government:** "BOCA RATON CITY MANAGER RESIGNS JUST YEAR INTO NEW JOB"; "Boca Raton Mayor Andy Thomson Hosts Town Hall Meeting Tonight"; "Palm Beach County Offering Homeowners Up To $100,000 For Home Repairs"; "MOSQUITO ALERT: Palm Beach County Set To Spray From Air Over Boca, Boynton, Delray"; "Sheriff Dr. Gregory Tony Suspends All Negotiations With County Over Budget".
- **Development and land use:** "WATCH LIVE: West Boca Raton, Delray Beach Agricultural Reserve Public Meeting"; "ISLAMIC CENTER: Palm Beach County Reminds That Meeting Is NOT About Proposal".
- **Elections:** "Early Voting Starts This Week At 28 Palm Beach County Sites"; "VOTE: Deadline Nears To Register For November Election In Palm Beach County"; "Palm Beach County Elections Office Launches Free 'Vote Palm Beach' App".
- **Schools:** "Florida Names 45 Palm Beach County Schools 'Excellent,' Whispering Pines Elementary Not Listed"; "Palm Beach County Schools To Fire Two Employees, Bar Convicted Teacher"; "REMINDER: NO SCHOOL TODAY FOR PALM BEACH COUNTY PUBLIC STUDENTS"; "FAU Leads $5.7 Million Effort to Boost Broward Literacy, Teacher AI Training".
- **Inspections and code:** "GARY WOO EXPRESS LOGS 18 HEALTH CODE VIOLATIONS"; "LONG ISLAND BAGEL AND DELI IN WEST BOCA RATON LOGS 20 HEALTH VIOLATIONS"; "ARE YOUR NEIGHBORS FOLLOWING THE RULES? We Have The County Code Compliance Violation List…".
- **Traffic roundups:** "TRAFFIC ALERT: There Are Again More Than 200 Projects Causing Slowdowns In Palm Beach County".
- **Events and community:** "Free 'I Read Dead People' Haunted Library Event Returns To Palm Beach County"; "Boca Helping Hands Seeks Help Feeding 24,000 People This Thanksgiving"; "Pompano Beach Drone Show Returns Nov. 7 …".

## 2. Where the information comes from

| Category | Evident source | Primary public record? |
| --- | --- | --- |
| Arrests | Police reports and probable-cause affidavits ("a police report reviewed by BocaNewsNow.com"), booking photos credited "Courtesy Palm Beach County Jail" (PBSO booking). Their policies page cites police, prosecutors and public databases under Fla. Stat. ch. 119. | Yes (arrest reports, booking), but usually **not** an official press release |
| Police incidents and shootings | PBSO, Boca Raton PD and FBI statements ("COPS:", "Police Say …"), plus on-scene and scanner monitoring, inferred from overnight "large presence" posts | Partly (official statements); scanner and on-scene reports are not records |
| Crashes | Police and FHP statements; road-closure posts that look scanner- or 511-driven (inferred) | Partly |
| Fire | Boca Raton Fire Rescue on scene and statements (inferred: unit counts, inspectors called) | Partly |
| Weather and hurricanes | National Hurricane Center advisories; NWS advisories; Governor's executive orders | Yes |
| Lawsuits | New filings in Palm Beach County Circuit Court ("filed suit Wednesday", "according to the complaint"), i.e. the Clerk's eCaseView | Yes (court records) |
| Restaurant inspections | Florida DBPR Hotels & Restaurants inspection results, printed as the "unedited list of violations"; links to `www2.myfloridalicense.com` | Yes |
| Code-violation list | PBC Code Compliance Special Magistrate hearing agenda (the agenda PDF is reproduced, each case with its owner name and case number) | Yes |
| Road work roundups | PBC Road and Bridge Construction List (176 items) plus FDOT lane closures (27 items), as stated in the story | Yes |
| City government | City of Boca Raton announcements, quoted verbatim ("Here is the official statement") | Yes (city release) |
| Development and land use | Attendance at and livestreams of county Agricultural Reserve meetings; county statements | Yes (public meetings), plus reporter commentary |
| Elections | Supervisor of Elections announcements | Yes |
| Schools | Florida DOE lists (School of Excellence); School Board agenda items (terminations) | Yes |
| County programs | PBC news releases (home repair grants, mosquito spraying) | Yes |
| Real estate | A paid press release from the buyer (EOD Properties), labeled "Local Journalism Supporter Content" | **No** (paid PR) |
| Travel and consumer | Airline and Florida Lottery press releases | No (company PR); the lottery is a state agency |
| Community and events | Nonprofit and venue press releases | No (organizations' PR) |
| Opinion, "Boca Rudeton" | Reader submissions via a submission center; tips via a "news tip center" | No |

## 3. Cadence, style, monetization

- **Cadence:** 110 posts in 22 days, **about 5 a day** (range 2–7, median 5), seven days a week, published from about 9 a.m. to 11 p.m. ET.
- **Headlines:** 17 of 110 are entirely in capital letters, and many more open with an all-caps kicker ("HURRICANE CENTER:", "COPS:", "TRAFFIC ALERT:", "LAWSUIT:", "WATCH LIVE:", "INCREDIBLE:"). Headlines are often editorial ("Shocking Revelation To Astonishingly Uninformed Citizens", "The Weather's Been Sucky").
- **Dateline:** each story opens "BOCA RATON, FL (BocaNewsNow.com) (Copyright © 2026 MetroDesk Media, LLC) —".
- **Length:** most news stories run 150–600 words (sample: 159, 306, 350, 383, 432, 433, 535, 577). Inspection stories run 900–1,200 words because they reprint violation lists. The weekly code-violation and road-project lists run about 6,000 words.
- **Bylines:** the feed author is the house name "BOCA NEWS NOW". Commentary pieces carry "BY: ANDREW COLTON | Editor and Publisher".
- **Monetization:**
  - Display ads through **Ezoic** and Google (stated on the policies page; Ezoic's Gatekeeper consent manager loads).
  - **Paid press releases at $185** ("network access fee"): homepage placement for at least 24 hours, inclusion in the nightly newsletter, and syndication. These run labeled "Local Journalism Supporter Content", not "Sponsored".
  - A "Sponsored Spotlight Articles / SEO-Optimized Business Profiles / Homepage & Newsletter Exposure" package on `/advertising` (a one-sheet, prices not shown).
  - A **free nightly newsletter** plus breaking-news email alerts (`newsalert.bocanewsnow.com`), claimed at more than 30,000 subscribers.
  - Syndication to Apple News, NewsBreak, SmartNews and Google News.
  - Stated policies: no paid removal of mugshots or arrest reports, and no new ads from arrest subjects within 90 days.

## 4. Primary sources TownCore should add for Boca Raton (ranked)

Already live for Boca: the myboca.us CivicPlus calendar and News Flash, DBPR licenses, Sunbiz filings and NWS FLZ168. Hosts were probed on 2026-10-16 with our User-Agent.

1. **Florida DBPR restaurant and lodging inspections.**
   - Agency: Division of Hotels & Restaurants.
   - Where: `https://www2.myfloridalicense.com/hotels-restaurants/public-records/`, with CSV extracts under `/sto/file_download/extracts/` (the same host our `fl-dbpr` adapter already uses) and a documented file layout.
   - Type: **downloadable dataset.**
   - Concerns: robots.txt allows these paths (only `/wp-admin/`, `/wp-includes/`, `/wp-content/` are disallowed). The interactive portal on `www.myfloridalicense.com` has its own inspection terms of use (`/portalsearches/InspTermsOfUse`), so use the extracts, never the portal search. We have not verified how often the extracts update.
   - Rule: failures are Tier 3.
2. **Official police and fire releases.**
   - Boca Raton Police Services: media relations at `myboca.us/2042/Media-Relations`. Check whether its releases already come through our News Flash feed (unverified).
   - PBSO: media relations at `pbso.org`. Its robots.txt allows all paths except `/search` and admin paths. It offers email **News Alerts** and a "Dispatch" newsletter by subscription; we could receive those through our SES inbox (an email feed). No release archive URL was found (unverified).
   - Boca Raton Fire Rescue: unverified.
   - This is the only rule-compliant basis for arrest and crime stories (Tier 3).
3. **Palm Beach County weekly Road and Bridge Construction List.**
   - Agency: PBC Engineering, Traffic Division.
   - Where: `https://discover.pbc.gov/Roads Reports/Road and Bridge Construction List <M.D.YY>.pdf`.
   - Type: weekly **PDF** at a predictable filename; that path isn't disallowed by robots.txt.
   - Add FDOT District 4 lane closures. FL511's `/list/getdata/` and `/eventdetails/` are disallowed; FL511 has a developer API whose terms we have not verified.
   - This is a Tier 1 roundup they run weekly.
4. **National Hurricane Center.**
   - Where: `www.nhc.noaa.gov` RSS and XML feeds (for example the Atlantic index feed); robots.txt allows everything.
   - Type: **feed.**
   - Use: templated Tier 1 tropical updates. Their single biggest non-crime series.
5. **Palm Beach County Commission and land-use agendas.**
   - Where: `https://discover.pbc.gov/countycommissioners/Agenda_Master_HTML/<YYYYMMDD>.htm` (HTML) and `/Agenda_Master/<date>.pdf`. Also Zoning Commission and Planning agendas (URLs unverified).
   - Concerns: no Legistar found for the county; robots.txt disallows only SharePoint system paths.
   - Use: covers the Agricultural Reserve and West Boca (unincorporated) development that Boca's own agendas miss.
6. **Elections.**
   - Agency: PBC Supervisor of Elections, `www.votepalmbeach.gov`.
   - Concerns: **its robots.txt returned 403 to our bot**, so fetching it is blocked until resolved.
   - Alternative: Florida Division of Elections results and candidate data (unverified host and terms).
   - Use: Tier 2 dates, candidate lists and results.
7. **Property sales.**
   - Agency: PBC Property Appraiser, `pbcpao.gov` (robots.txt is an empty 200, meaning allowed). Its CAMA bulk file is CSV but published only twice a year; more current sales need the data request form (`pa-pubsvc@pbcpao.gov`).
   - Alternative: the Florida Department of Revenue NAL/SDF sales files (unverified freshness).
   - Use: a weekly home and commercial sales roundup they don't have (we'd beat them).
8. **PBC Code Compliance Special Magistrate agendas.**
   - Where: `https://discover.pbc.gov/pzb/CodeCompliance/Pages/Special-Magistrate.aspx`. Monthly hearings, usually on the first Wednesday; **agenda PDFs**. The agenda file URL pattern is unverified.
   - Rule: report in aggregate by area and violation type, without owner names (see section 5).

Further sources, lower priority or blocked:

9. **Florida DOE school data** (grades, School of Excellence). `www.fldoe.org` returned **403 to our bot**, so it is blocked; look for a data host. The School District of Palm Beach County (`palmbeachschools.org`) has a robots.txt with Crawl-delay; its School Board agenda platform is unverified.
10. **Boca Raton building permits.** "Boca eHub" (`myboca.us/2235/Boca-eHub`). No free bulk or public search feed was found; the city sells open-permit searches at $150 per address. Ask the Building Department for a data export (unverified).
11. **FHP live crash report** (`flhsmv.gov/florida-highway-patrol/traffic-incidents/`, a web page updated every 5 minutes). It covers highway and unincorporated crashes only; terms and robots.txt are unverified. Crashes are a police beat, so Tier 3.
12. **PBC Clerk civil filings (eCaseView).** `www.mypalmbeachclerk.com` returned **403 to our robots.txt request**. The site's notice limits use to personal, non-commercial use and bars storing content without written permission. **Do not automate.** It would need written permission from the Clerk. Lawsuits are 8% of their output.

Also worth adding: PBC news releases (grants, mosquito spraying, county programs; URL unverified) and Delray Beach's Legistar (already supported) for the cross-border stories they cover.

## 5. Categories TownCore must not replicate

Flagged against Rules 3 and 9 and the §7 tiers:

- **Mugshots.** Arrest stories lead with booking photos ("Courtesy Palm Beach County Jail"). **Tier 4**, never.
- **Named arrestees from arrest reports, probable-cause affidavits or booking logs without an official release** (most of the 21 arrest posts, including DUI and minor drug charges). **Tier 4** unless an official release exists; with a release, still Tier 3.
- **Stories involving minors**: children left home alone, a child said to have helped a theft, a "child case" bond, and the "Bar Convicted Teacher" item if students are identifiable. **Tier 4** if a minor is named or identifiable.
- **Sexual-assault allegations**: the rape lawsuit and the student reporter suit. **Tier 4** for victims; never name them.
- **Civil lawsuits naming private plaintiffs and defendants** (9 posts). **Tier 3** at minimum, and the court-records source is off-limits anyway.
- **Code-violation lists naming property owners.** Private individuals, so **Tier 3**. Prefer counts by area and violation type without names.
- **Death investigations, shootings with named victims, and fatal crashes identifying the dead**: **Tier 3**, and only from official releases. Scanner- or on-scene-based "large police presence" posts have no primary record, so don't write them.
- **Bodycam video, reader-submitted "Boca Rudeton" posts and vigilante posters**: private people and social or reader content, so **Tier 4** or out of scope.
- **Editorial opinion and loaded headlines** ("Shocking Revelation To Astonishingly Uninformed Citizens", the outlet's own disputes): conflicts with our plain, factual tone (§6, §6a headlines).
- **Paid releases presented as news** ("Local Journalism Supporter Content"): our paid content must carry the locked "Sponsored" label (Rule 6). Company press releases are not primary sources for full articles.
- **Restaurant inspections are allowed** (a DBPR public record) but are **Tier 3** when they report failures. Summarize; don't reprint violation lists as a "gotcha".

## Opportunities

- At least 40% of their output is public safety, much of it from arrest reports. Our 20% cap and official-release rule make us a different, calmer product.
- Gaps we can fill from records we already have or plan to add: new business filings and licenses (Sunbiz and DBPR, already live), weekly property sales, permits, city meeting previews and recaps, school board actions, and a daily morning email with weather. They have no organized business directory; we do.
- Their weekly roundups (road projects, code cases, inspections) show readers want list-style public-records digests. These are Tier 1 or Tier 3 templated jobs for us.
