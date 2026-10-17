# Sports coverage plan

Status: owner approved the direction on 2026-10-16 ("I approve all of the above"): high school
sports at team level, pro and college with a local angle, reader-sent scores later, and a price
check on licensed sports data. Nothing paid is bought without a separate yes (§14).

## What readers get

- **High school, team level.** This week's games and last week's finals for the town's schools,
  playoff brackets when the state series starts, and a `schools-sports` homepage module with the
  next games and recent scores. Written as a weekly roundup in code, like the permit roundups:
  team names, opponents, scores, dates and places, never a player's name.
- **Pro and college, local angle.** Only from sources we're allowed to use (below): games played
  in or near town, team community events that a city or county calendar lists, and stadium or
  road-closure notices from official releases. No box scores or standings until a licensed feed
  is approved.
- **Reader-sent scores (later).** Coaches and parents send a final through a form like `/photos`;
  an editor approves it. Team scores only.

## Rules that shape it

- **Minors (§7, Tier 4).** A story that names a high school athlete is blocked unless a reviewer
  overrides it. The roundup is built from team-level data only, so it stays Tier 1 and can
  auto-publish. The tier rules already flag "student-athlete" and similar words.
- **Rule 8.** No paid sports databases (MaxPreps and similar are out). Respect robots.txt and
  terms, including Crawl-delay and the Visit-time extension.
- **Rule 3.** Other outlets' game stories are never a source.

## Sources checked (2026-10-16)

| Source | What it has | Access | Verdict |
| --- | --- | --- | --- |
| FHSAA (fhsaa.com, Sidearm Sports) | State association: composite calendar (RSS, Excel and text downloads), team schedules, brackets, results | robots.txt allows all but `/images/`, `/documents/`, `/services/` and a few others; **Crawl-delay 5 and Visit-time 0100–0645 (UTC)** | **Stopped (2026-10-17): its legal notice forbids reuse** (below). Not built |
| Palm Beach County schools (palmbeachschools.org) | District athletics page | Allowed (Crawl-delay 5), but the page is drawn by JavaScript; a plain fetch gets nothing | Skip for now |
| FAU Athletics (fausports.com, Sidearm) | College schedules and results | Bot protection (Incapsula) blocked our second request | Skip: we never work around a block |
| Other Sidearm college sites (e.g. miamihurricanes.com) | Schedules, results, iCal | robots.txt allows `/` | Possible via the same adapter, for towns near a college |
| Pro team sites (miamidolphins.com, nhl.com, intermiamicf.com, mlssoccer.com) | News, schedules | robots.txt allows most paths, but their terms bar commercial reuse of content | Skip as data sources; only official public-safety notices (road closures, stadium events) via city and county releases |
| MaxPreps | High school stats | A commercial sports database | Never (Rule 8) |

**FHSAA's terms (read 2026-10-17, inside the window).** Its legal notice
(`/sports/2020/5/4/legaldisclaimer.aspx`) says the content is FHSAA's copyright and that visitors
may not "'mirror' or include this information on your own server or documents without our
permission" or "modify or re-use the text or graphics"; personal use and links only. Game dates
and scores are facts, but the notice bars including its information on our server, so we don't
build the adapter or fetch the calendar. Three requests were made (robots.txt, the home page, the
notice), each at least 5 seconds apart inside the Visit-time window. Ways forward, the owner's
call: ask FHSAA for written permission (or a data license); take scores from each school's own
athletics pages where their terms allow; or reader-sent scores with the photo form's approval
flow.

Visit-time support landed in the Fetcher with this plan: outside a host's window a fetch counts as
"nothing new" (the source stays healthy) and the next run inside the window fetches.

## Licensed data for pro scores (prices found 2026-10-16, unverified with sales)

| Provider | Price | Notes |
| --- | --- | --- |
| API-Sports (American football, plus separate APIs per sport) | About $25–35 a month per sport for high-volume plans | Covers NFL and NCAA football; other sports are separate subscriptions; check that display on a commercial site is allowed |
| SportsDataIO | $99–149 a month self-serve, but one-day delayed and **not licensed for commercial redistribution**; live commercial data by quote (median buyer about $16,500 a year) | Self-serve tiers don't fit |
| Sportradar | Custom contracts, roughly €1,300–5,000+ a month | Enterprise; poor fit for now |
| TheSportsDB | About $5–9 a month (Patreon supporter key) | Community data, commercial use unclear |

Recommendation: no pro-score feed yet. If the owner wants live pro scores later, start with
API-Sports for the sports that matter in a given region, after reading its license for display
on a commercial news site.

## Build order

1. Fetcher: robots.txt Visit-time (done, with tests).
2. `sports` source kind (enum migration) and town config: the town's schools with the names the
   state association uses.
3. `sidearm` adapter: on hold. FHSAA's terms bar reuse without written permission (above); the
   Owner, 2026-10-17: ask FHSAA for a data license (letter drafted in `docs/sports/fhsaa-data-license-request.md`, for the owner to send); readers send final scores meanwhile, approved by staff in Admin → Scores.
   same adapter could still read a Sidearm site whose terms allow it.
4. Weekly high school sports roundup built in code (Tier 1), the `schools-sports` module, and
   scores in the newsletter's Coming up.
5. Reader-sent scores (with the photo form's approval flow), after the roundup proves useful.

## Open questions for the owner

- Which towns get sports first (Boca now; it has eight high schools, public and private).
- Whether to price API-Sports for Dolphins, Panthers, Heat, Marlins and Inter Miami scores.
