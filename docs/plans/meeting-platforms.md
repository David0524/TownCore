# Meeting platforms: survey and build order

Agendas, minutes and meeting video beyond CivicPlus (owner request, 2026-10-16). This is the survey, checked live against Rule 8 with our bot's User-Agent, and the order we build adapters in (§9, launcher step 4). Status: **Legistar and CivicClerk built** (`packages/adapters/src/legistar`, `packages/adapters/src/civicclerk`); **Swagit transcripts** fetched through CivicClerk's video links (`packages/adapters/src/swagit`; owner approved 2026-10-16); the rest in the order of §4 below.

---

Scope: platforms US cities use to publish council/commission agendas, minutes and video, checked against
CLAUDE.md Rule 8 (robots.txt, 1 req/s per host, `TownCoreBot/1.0 (info@towncore.net)`, documented-API
exception only via `DOCUMENTED_APIS` in `packages/adapters/src/http/policy.ts`).

Method: every robots.txt below was fetched live today with our User-Agent at <= 1 request/second per host
(60 s spacing on iqm2.com, which asks `Crawl-delay: 60`). Pages were fetched only after checking robots.txt.
"Verified" = seen live today. "Unverified" = not confirmed live. Our Fetcher treats a 4xx robots.txt as
"no rules" (RFC 9309) and 5xx/unreachable as "disallow all"; verdicts below use the same reading.

Process notes (honesty): (1) in one shell command I fetched `westjordan.primegov.com/api/v2/PublicPortal/ListUpcomingMeetings`
in the same command as its robots.txt, before reading that robots.txt says `Disallow: /`. One request, response `[]`, not
repeated. (2) `wpb.org/.../WPB-TV-Video-on-Demand` redirected to `youtube.com/c/WestPalmTV/videos`; my script checked
robots for wpb.org only. YouTube's robots.txt does not disallow `/c/`, so the fetch was allowed anyway, but the production
Fetcher should re-check robots.txt after cross-host redirects (worth confirming it does). (3) One diagnostic request for
`go.boarddocs.com/robots.txt` with a browser User-Agent, to see if the 403 was UA-specific (it was still 403).

---

## 1. Summary table

| Platform | Example cities (verified live) | Robots verdict for TownCoreBot | Machine-readable route | Build priority |
| --- | --- | --- | --- | --- |
| **Legistar Web API** (Granicus) `webapi.legistar.com/v1/{client}` | Delray Beach, Fort Lauderdale, Hollywood, Pompano Beach, Wellington, Margate, Pembroke Pines, Miramar, Coconut Creek, Broward County, Doral | **Allowed.** robots.txt 404 (no rules). Documented public API. | OData JSON: `/events`, `/events/{id}/eventitems`, `/matters`, `/bodies`, votes. Docs: `https://webapi.legistar.com/Home/Examples` | **1** |
| Legistar web UI `{client}.legistar.com` | same | **Allowed** (robots.txt 404) | `MeetingDetail.aspx`, `Calendar.aspx`, `View.ashx?M=A/M/IC&ID=..&GUID=..` serves the PDF/iCal directly | 1 (part of Legistar adapter) |
| Legistar file hosts `legistar.granicus.com`, `legistar2.granicus.com`, `{client}.legistar1.com` | (URLs returned in API `EventAgendaFile`) | **Disallowed** (`User-agent: * / Disallow: /`) | Do not fetch; use `View.ashx` on the client host instead | n/a |
| **CivicClerk** (CivicPlus) `{tenant}.api.civicclerk.com/v1` | Jupiter, Deerfield Beach, Parkland, Town of Palm Beach, North Palm Beach, Greenacres, Lighthouse Point, Dania Beach, Wilton Manors, Alachua | **Allowed.** api host robots.txt 404; portal robots `User-agent: *` with no Disallow | OData JSON `/Events` incl. `publishedFiles`, `externalMediaUrl`; `/Meetings/GetMeetingFileStream(fileId=N,plainText=true)` returns agenda **text** | **2** |
| **Swagit** (Granicus) `{tenant}.new.swagit.com` | Jupiter, Parkland (current); Tamarac (2014-2022 seen) | **Allowed** (robots.txt is all comments). Asset hosts `swagit-*.granicus.com` robots = 403 (no rules) | HTML `/videos/{id}`; **plain-text transcript** `/videos/{id}/transcript`; WebVTT captions; agenda PDF on `swagit-attachments.granicus.com` | **3** |
| **YouTube Data API v3** | Delray (@cityofdelraybeachfl), Deerfield, Hollywood, WPB (@WestPalmTV), Boynton, PBG, Coral Springs | API allowed under documented-API terms (needs `YOUTUBE_API_KEY`); `youtube.com/feeds/videos.xml` disallowed | `channels.list` -> uploads playlist -> `playlistItems.list` (1 unit) -> `videos.list` (1 unit). Quota 10,000 units/day + 100 `search.list`/day | **4** (already planned, D-2026-10-15) |
| **CivicPlus Agenda Center** `/AgendaCenter` on CivicEngage sites | Jupiter (older items), Hollywood (boards), Parkland (older), Palatka, Hialeah, Florida City | **Allowed** on every CivicEngage robots.txt checked (standard template does not list /AgendaCenter) | HTML list; PDFs `/AgendaCenter/ViewFile/Agenda/_MMDDYYYY-ID` (+ `?html=true`), `/ViewFile/Minutes/...`. RSS `RSSFeed.aspx?ModID=65&CID=All-0` returned an empty channel on Jupiter | **5** (extend existing `civicplus` adapter) |
| **eSCRIBE** `pub-{tenant}.escribemeetings.com` | Gainesville, Haines City, Holmes Beach (FL); Ottawa | **Allowed** (only `PetalBot` disallowed) | JSON POST `MeetingsCalendarView.aspx/GetCalendarMeetings` with `{calendarStartDate,calendarEndDate}`; HTML agenda `Meeting.aspx?Id=..&Agenda=Agenda`; docs `filestream.ashx?DocumentId=N`; video player link | 6 |
| **iQM2 / Destiny "Accela Meetings"** `{tenant}.iqm2.com` | Miami | **Allowed, `Crawl-delay: 60`** | RSS `/Services/RSS.aspx?Feed=Calendar` (served as XHTML); `Citizens/Detail_Meeting.aspx?ID=N`; files `Citizens/FileOpen.aspx?Type=1|14|12|15&ID=N` | 7 |
| **OnBase Agenda Online** (Hyland) `*.hylandcloud.com/{n}agendaonline/` | Tampa | **Allowed** (robots.txt 404) | HTML `Meetings/ViewMeeting`, `Meetings/Agendas`; full-text search form | 8 |
| **Municode Meetings** `{tenant}.municodemeetings.com` (Drupal) | Eustis (verified host; recency unverified) | **Allowed, `Crawl-delay: 15`**; `/search/`, `/admin/` etc. disallowed | HTML `/bc-citycommission/page/...`; PDFs under `/sites/{host}/files/fileattachments/...` | 9 (low) |
| **Granicus MediaManager / ViewPublisher** `{client}.granicus.com` | Boca Raton, Delray Beach, Boynton Beach, Fort Lauderdale, Hollywood, Margate, Pembroke Pines, Pompano Beach, Wellington, Coconut Creek, Miramar, Coral Springs | **Disallowed** (`User-agent: * Disallow: /`; named search engines only allowed) | Off-limits. Link out only (URLs found on allowed pages) | **Do not build** |
| **PrimeGov** `{client}.primegov.com` | West Jordan UT (Palm Bay FL reported by city, host not resolvable here) | **Disallowed** (`User-agent: * Disallow: /`) | Off-limits (has `/api/v2/PublicPortal/...` JSON, but no published terms inviting automated use found) | Do not build |
| **AgendaQuick** (Destiny) `public.destinyhosted.com` | Fort Pierce (2017-18 per search) | **Disallowed** (`User-agent: * Disallow: /`) | Off-limits | Do not build |
| **Laserfiche WebLink** (city-hosted archive) | Palm Beach Gardens `lf.pbgfl.com` (disallowed), Boynton `weblink.bbfl.us` (robots 404 = allowed), Parkland `documents.cityofparkland.org` (robots 403) | **Per host** | HTML browse; archive, not a meeting feed | Low; minutes archive only |
| **BoardDocs** (Diligent) `go.boarddocs.com` | (mostly school boards; FL example not verified) | **Blocked in practice**: robots.txt and pages return 403 to us | none usable | Do not build |
| **CivicWeb / iCompass** (Diligent) `{tenant}.civicweb.net` | none verified | **Unverified**: every civicweb.net host tried returned proxy 502 from this environment | unknown | Unverified |
| **NovusAgenda** (Granicus) `{tenant}.novusagenda.com/agendapublic` | Palm Bay legacy archive (page loads but shows "An HTTP error occurred") | robots.txt 404 (= allowed) | ASP.NET pages `Meetings.aspx`, `MeetingView.aspx`, `CoverSheet.aspx` (unverified) | Low; no live FL client verified |
| **City CMS pages** (Granicus OpenCities, Vision/"showpublisheddocument", WordPress) | West Palm Beach (OpenCities), Sunrise, Plantation, Lake Worth Beach | WPB allowed; Sunrise/Plantation/Lake Worth Beach return **403** to us | per-site HTML/PDF; generic `page` adapter at best | Case by case |

---

## 2. Palm Beach and Broward city inventory (verified 2026-10-16)

| City | Agendas | Video | How verified | Notes |
| --- | --- | --- | --- | --- |
| **Boca Raton** | Granicus MediaManager `bocaraton.granicus.com/ViewPublisher.php?view_id=2/9` (linked from `myboca.us/129/Agendas`) | Granicus; YouTube | robots `Disallow: /` | **Off-limits** (known; D-2026-10-15). Not on Legistar or CivicClerk API |
| **Delray Beach** | **Legistar** (API client `delraybeach`; latest City Commission 2026-10-13) | Granicus `delraybeach.granicus.com` (blocked); YouTube `@cityofdelraybeachfl/streams` linked from Legistar calendar | API + `delraybeach.legistar.com/Calendar.aspx` | City site `delraybeachfl.gov` returns 403 to us (robots too). Agenda PDFs in API point to `delraybeach.legistar1.com` (disallowed); use `View.ashx` on `delraybeach.legistar.com` (`M=A`, `M=IC` iCal links present). **Good news for the first M7 launch** |
| **Boynton Beach** | Granicus `boynton-beach.granicus.com/ViewPublisher.php?view_id=1` (blocked); Laserfiche `weblink.bbfl.us` (allowed) | YouTube `cityofboynton`; Granicus | `boynton-beach.org/129/Agendas-Minutes` | Agendas effectively blocked; Laserfiche archive + YouTube usable |
| **Deerfield Beach** | **CivicClerk** `deerfieldbeachfl` | YouTube (`externalMediaUrl` per meeting in CivicClerk) | API | |
| **Pompano Beach** | **Legistar** (API client `pompano`); also PDFs on `cdn.pompanobeachfl.gov/city/storage/meeting_agendas/` (per search) | Granicus `pompano.granicus.com` (blocked) | API + `pompano.legistar.com/Calendar.aspx` | |
| **Coral Springs** | Unverified: city `/agenda` redirects to `/Redirection-Links/Commission-Agenda`, which robots.txt disallows; also `Disallow: /Agenda` | `coralsprings.granicus.com` tenant exists (blocked); YouTube `@CityofCoralSprings` | robots | Treat as blocked until a platform host is found |
| **Jupiter** | **CivicClerk** `jupiterfl` (current); older AgendaCenter files | **Swagit** `jupiterfl.new.swagit.com` (in CivicClerk `externalMediaUrl`), transcripts available | API + Swagit pages | Best-covered town checked |
| **West Palm Beach** | City CMS (Granicus OpenCities) pages and PDFs under `/files/assets/city/...` | YouTube `@WestPalmTV` | `wpb.org` pages (allowed) | No agenda platform; needs `page`-style adapter |
| **Fort Lauderdale** | **Legistar** `fortlauderdale` | Granicus (blocked) | API, MeetingDetail page | `fortlauderdale.gov` robots disallows `/Government/City-Commission/` |
| **Wellington** | **Legistar** `wellington` (bodies incl. "ACME Improvement District" confirm FL) | Granicus (blocked) | API + calendar | `wellingtonfl.gov` returns 403 to us |
| **Palm Beach Gardens** | Laserfiche `lf.pbgfl.com` (**disallowed**) | YouTube `citypbg` | `pbgfl.gov/482/Agendas` | Agendas blocked; YouTube only |
| **Lake Worth Beach** | City WordPress page `lakeworthbeachfl.gov/government/commission-agendas-and-minutes` (per search) | unverified | site returns 403 to us | Blocked in practice |
| **Hollywood** | **Legistar** `hollywoodfl`; AgendaCenter for some boards | Granicus (blocked); YouTube `@HollywoodFLCH78` | API + calendar | |
| **Pembroke Pines** | **Legistar** `ppines`; AgendaCenter links to Legistar | Granicus (blocked); YouTube | API + `ppines.com/AgendaCenter` | |
| **Margate** | **Legistar** `margatefl` | Granicus (blocked) | API | |
| **Coconut Creek** | **Legistar** `coconutcreek` | Granicus (blocked) | API | |
| **Miramar** | **Legistar** `miramar` | Granicus (blocked) | API | |
| **Parkland** | **CivicClerk** `parklandfl` | **Swagit** `parklandfl.new.swagit.com`; Laserfiche docs | API | |
| **Tamarac** | Unverified (tamarac.org connection resets from here) | Swagit `tamaracfl.new.swagit.com` (2014 list seen; 2022 agenda pages per search) | Swagit robots | |
| **Sunrise**, **Plantation** | City CMS (Granicus Vision, `showpublisheddocument` URLs per search) | unverified | sites return 403 to us | Blocked in practice |
| Town of Palm Beach, North Palm Beach, Greenacres, Lighthouse Point, Dania Beach, Wilton Manors | **CivicClerk** | per meeting (`externalMediaUrl`) | API | |
| Broward County | **Legistar** `broward` | | API | Miami-Dade's `miamidade` client last event 2018 (moved) |

Tally for the 27 municipalities above (Broward County excluded): Legistar 9, CivicClerk 9 (incl. six small towns), Granicus MediaManager only 2 (Boca, Boynton), CMS/Laserfiche/unverified 7 (Coral Springs, WPB, PBG, Lake Worth Beach, Tamarac, Sunrise, Plantation). Granicus video sits behind most Legistar cities and is blocked; YouTube or Swagit is the usable video path.

---

## 3. Platform details

### 3.1 Legistar (Granicus) - Web API
- Examples: Fort Lauderdale `https://webapi.legistar.com/v1/fortlauderdale/events`, Delray `.../delraybeach/...`, Hollywood `.../hollywoodfl/...`. Unknown clients return HTTP 500 `LegistarConnectionString setting is not set up in InSite for client: X` (a cheap existence probe for the launcher).
- robots.txt: `webapi.legistar.com/robots.txt` -> 404 (no rules = allowed). `{client}.legistar.com/robots.txt` -> 404 (allowed). `legistar.granicus.com` and `legistar2.granicus.com` -> `User-agent: * / Disallow: /`. `delraybeach.legistar1.com`, `coconutcreek.legistar1.com` -> `User-agent: * / Disallow: /`. `legistar1.granicus.com` -> 404.
- Terms: the API site says "Legistar Web API exposes Legistar data to the web directly over HTTPS", "Items returned to GET requests are limited to those items marked as public", "Some clients require use of an API Token", replies capped at 1000 rows, OData paging/filter. No separate terms-of-use page found. Since robots.txt has no rules, no DOCUMENTED_APIS entry is needed.
- Routes: `/v1/{c}/bodies`, `/events?$filter=EventDate ge datetime'YYYY-MM-DD'`, `/events/{id}/eventitems?AgendaNote=1&MinutesNote=1&Attachments=1`, `/matters/{id}/histories`, `/eventitems/{id}/votes`. Event fields: `EventAgendaFile`, `EventMinutesFile`, `EventVideoPath` (null in FL samples), `EventInSiteURL`, `EventAgendaStatusName`, `EventMinutesStatusName`.
- Documents: API file URLs point at the disallowed file hosts. The allowed path is `EventInSiteURL` (`{client}.legistar.com/MeetingDetail.aspx?...`), whose HTML links `View.ashx?M=A` (agenda), `M=M` (minutes), `M=AADA/MADA` (accessible versions), `M=IC` (iCal). `View.ashx?M=A&ID=..&GUID=..` on `fortlauderdale.legistar.com` returned `200 application/pdf` directly. Agendas are PDFs; item titles/actions/votes come as JSON.
- Video: `Video.aspx?Mode=Granicus...` -> Granicus MediaManager (blocked). Link out only.
- detect(): host `*.legistar.com`, `webapi.legistar.com`; HTML containing `Legistar`, `MeetingDetail.aspx`, `View.ashx?M=A`.
- Owner decision to flag: whether to ask for `legistar.granicus.com` / `*.legistar1.com` in DOCUMENTED_APIS as the API's file host. Not recommended: they are plain websites with `Disallow: /`, and `View.ashx` on the allowed host already serves the same PDFs.

### 3.2 Granicus MediaManager (legacy) - `*.granicus.com`
- Every tenant checked serves the same robots.txt: Googlebot, Slurp, msnbot, search-one-scgov `Disallow: /JSON.php`, `Crawl-delay: 10`; then `User-agent: *` `Disallow: /`. Checked: bocaraton, delraybeach, boynton-beach, ppines, fortlauderdale, hollywoodfl, margatefl. Non-tenants return a 404 HTML page for robots.txt (usable as an existence probe).
- Routes (not fetched): `ViewPublisher.php?view_id=N`, `MediaPlayer.php?view_id=&clip_id=`, `AgendaViewer.php`, `ViewPublisherRSS.php` (unverified).
- Verdict: **off-limits** to us. No public API with published terms found (unverified). The launcher readiness score must not count it.

### 3.3 CivicClerk (CivicPlus) - `{tenant}.portal.civicclerk.com` / `{tenant}.api.civicclerk.com`
- Examples: `https://jupiterfl.api.civicclerk.com/v1/Events`, `deerfieldbeachfl`, `parklandfl`, `alachuafl` (portal `https://alachuafl.portal.civicclerk.com/`).
- robots.txt: portal hosts `# https://www.robotstxt.org/robotstxt.html / User-agent: *` (no Disallow -> allowed). API host robots.txt 404 -> allowed. Unknown tenants fail at DNS (proxy 502).
- Routes: OData `GET /v1/Events?$top=&$filter=startDateTime lt ...&$orderby=startDateTime desc`. Fields: `eventName`, `startDateTime`, `categoryName`, `eventLocation`, `agendaId`, `publishedFiles[] {type: Agenda|Agenda Packet|Minutes, fileId, name, url}`, `externalMediaUrl` (Swagit/YouTube/Laserfiche links), `youtubeVideoId`. File: `GET /v1/Meetings/GetMeetingFileStream(fileId=N,plainText=false)` -> PDF (`200 application/pdf`); `plainText=true` -> extracted text (verified on Alachua). No auth.
- Prevalence: CivicPlus reports ~1,500 clerk customers on its current agenda product page (an older page said 4,200); vendor-reported, unverified.
- detect(): host `*.civicclerk.com`; HTML referencing `portal.civicclerk.com`.

### 3.4 Swagit (Granicus) - `{tenant}.new.swagit.com`
- Examples: `https://jupiterfl.new.swagit.com/videos/403164` (Town Council 2026-10-06), `https://parklandfl.new.swagit.com/videos/403298`, `tamaracfl.new.swagit.com`.
- robots.txt: Rails default, all lines commented (`# User-agent: *` / `# Disallow: /`) -> allowed. `www.swagit.com`: `Disallow: /wp-admin/`, `Crawl-delay: 10`. `swagit-attachments.granicus.com`, `swagit-video.granicus.com` robots -> 403 (S3 AccessDenied) -> no rules.
- Routes: `/videos/{id}` (HTML; title has date and body), `/videos/{id}/transcript` (`text/plain`, timestamped, 94 KB for one meeting), `/videos/{id}/download`, captions `swagit-video.granicus.com/{tenant}/{uuid}-en.vtt`, agenda PDF `swagit-attachments.granicus.com/uploads/video/agenda_file/{id}/...pdf`. Listing pages (`/town-council`) were empty or old for Jupiter/Tamarac, so discovery should come from CivicClerk `externalMediaUrl` or a known id range (listing route unverified).
- Value: transcripts give meeting recap text without video processing (D-M2-4 deferred transcripts to M3; this is a ready source).

### 3.5 YouTube Data API v3
- Docs: `https://developers.google.com/youtube/v3`; quota page (fetched): "default quota allocation of 100 search.list calls, 100 videos.insert calls, and 10,000 units per day combined for all other endpoints"; `channels.list`, `playlistItems.list`, `videos.list` cost 1; `captions.list` 50. Terms: `https://developers.google.com/youtube/terms/api-services-terms-of-service` (not fetched today).
- `www.youtube.com/robots.txt` includes `Disallow: /feeds/videos.xml` (confirmed again). `www.googleapis.com/robots.txt` -> 404. The adapter calls the same API at `youtube.googleapis.com` (2026-10-16), whose robots.txt is YouTube's and has no rule for `/youtube/v3/`; cloud sessions inject a Google OAuth token on `www.googleapis.com` that overrides the API key (HTTP 401).
- Caption download through the API needs OAuth from the video owner (unverified today); plan on metadata only.

### 3.6 CivicPlus Agenda Center - `/AgendaCenter` on CivicEngage sites
- Examples: `https://www.jupiter.fl.us/AgendaCenter`, `https://www.hollywoodfl.org/AgendaCenter`, `https://www.ppines.com/AgendaCenter`, `https://www.cityofparkland.org/AgendaCenter`.
- robots.txt (standard CivicEngage template, identical on myboca.us, boynton-beach.org, deerfield-beach.com, jupiter.fl.us, pbgfl.gov, wellingtonfl.gov, hollywoodfl.org, margatefl.com, ppines.com, cityofparkland.org, tamarac.org): Baiduspider and Yandex `Disallow: /`; `User-agent: *` disallows `/activedit`, `/admin`, `/common/admin/`, `/OJA`, `/support`, `/Search*`, `/CurrentEvents*`, `/map.aspx` ... `/AgendaCenter` is **not** disallowed.
- Routes: HTML list grouped by category (`id="catN"`), files `/AgendaCenter/ViewFile/Agenda/_10062026-1471`, `?html=true` HTML version, `/AgendaCenter/ViewFile/Minutes/_MMDDYYYY-ID`, optional video/audio icons linking out (Swagit on Jupiter). RSS `RSSFeed.aspx?ModID=65&CID=All-0` returned a valid but empty channel; per-category RSS unverified.
- Note: several CivicPlus cities have moved their agendas to CivicClerk (Jupiter, Parkland), leaving Agenda Center as an archive.

### 3.7 eSCRIBE - `pub-{tenant}.escribemeetings.com`
- Examples: `https://pub-hainescity.escribemeetings.com`, `https://pub-cityofgainesville.escribemeetings.com`, `https://pub-holmesbeachfl.escribemeetings.com` (from search; Haines City and Gainesville robots verified).
- robots.txt: `User-agent: PetalBot / Disallow: /` only -> allowed.
- Routes: `POST /MeetingsCalendarView.aspx/GetCalendarMeetings` JSON body `{"calendarStartDate":"2026-09-01","calendarEndDate":"2026-10-31"}` returns `{d:[{ID, MeetingName, StartDate, Location, MeetingDocumentLink[{Type, Format, Url}], HasVideo...}]}` (verified). Agenda HTML `Meeting.aspx?Id={guid}&Agenda=Agenda|Merged|PostMinutes&lang=English`; docs `filestream.ashx?DocumentId=N`; video `Players/ISIStandAlonePlayer.aspx?Id=`.
- Mostly Canadian; a handful of FL cities.

### 3.8 iQM2 - `{tenant}.iqm2.com`
- Example: `https://miamifl.iqm2.com/Citizens/Calendar.aspx` (City of Miami).
- robots.txt: `user-agent: *` / `Crawl-delay: 60` (no Disallow). Served for any subdomain, so robots.txt is not a tenant probe. Our Fetcher caps Crawl-delay at 60 s, so it complies.
- Routes: RSS `/Services/RSS.aspx?Feed=Calendar` (verified; came back as XHTML with agenda/ minutes links), `Citizens/Detail_Meeting.aspx?ID=N`, `Citizens/FileOpen.aspx?Type=1` (full agenda), `Type=14` (public agenda), `Type=12`, `Type=15` (minutes types; exact meaning unverified).

### 3.9 OnBase Agenda Online (Hyland) - `*.hylandcloud.com/{nnn}agendaonline/`
- Example: `https://tampagov.hylandcloud.com/251agendaonline/` (Tampa; path number changes, the city warns old bookmarks break).
- robots.txt 404 -> allowed. Routes: `Meetings/Agendas`, `Meetings/ViewMeeting`, form `Meetings/GetMoreFullTextResults`. HTML.
- "AgendaQuick" is a different product (Destiny), hosted at `public.destinyhosted.com`, robots `User-agent: * Disallow: /` -> off-limits.

### 3.10 Municode Meetings - `{tenant}.municodemeetings.com`
- Example: `https://eustis-fl.municodemeetings.com/` (meeting pages `/bc-citycommission/page/city-commission-meeting-NN`; how current is unverified).
- robots.txt: `User-agent: *`, `Crawl-delay: 15`, standard Drupal disallows (`/admin/`, `/search/`, `/user/...`, `/?q=...`). Meeting pages and `/sites/.../files/fileattachments/...pdf` allowed.

### 3.11 PrimeGov - `{client}.primegov.com`
- Example host: `westjordan.primegov.com` (Utah). Palm Bay FL says it moved to PrimeGov (`palmbayfl.primegov.com` did not resolve here).
- robots.txt: `User-agent: *` / `Disallow: /` -> **off-limits**. A JSON API exists under `/api/v2/PublicPortal/` but no published terms inviting automated access were found.

### 3.12 BoardDocs (Diligent) - `go.boarddocs.com`
- robots.txt and pages return HTTP 403 to our requests (Akamai-style error page), also with a browser UA from this environment. Mostly school boards. Off-limits in practice.

### 3.13 CivicWeb / iCompass (Diligent) - `*.civicweb.net`
- Every host tried (sarasota, nanaimo, pickering, stlucieco, pompanobeach) failed with proxy 502 at CONNECT; could be DNS for wrong guesses or an egress policy for the whole domain. No US example verified. **Unverified.**

### 3.14 NovusAgenda (Granicus) - `{tenant}.novusagenda.com/agendapublic`
- `palmbay.novusagenda.com/agendapublic/` loads (200) but shows "An HTTP error occurred" (legacy archive). robots.txt 404 -> allowed. No active FL client verified.

### 3.15 Other common sources found
- **Laserfiche WebLink** (minutes archives): `lf.pbgfl.com` robots `Disallow: /`; `weblink.bbfl.us` robots 404 (allowed); `documents.cityofparkland.org` robots 403.
- **City CMS pages**: West Palm Beach (Granicus OpenCities, robots allows the agenda pages; weekly meeting list PDF `/files/assets/city/v/1/city-clerk/documents/wml-weekly-meeting-lists/...`). Sunrise, Plantation, Lake Worth Beach and Delray's own site answer 403 to our bot (likely a WAF; robots.txt also 403).

---

## 4. Recommended build order
1. **Legistar Web API adapter** (events + eventitems JSON; documents via `{client}.legistar.com/View.ashx`, never the `legistar1`/`legistar.granicus.com` hosts; iCal via `M=IC`). Covers 9 of the 27 nearby municipalities incl. **Delray Beach** (first M7 launch) and Fort Lauderdale, and many large US cities.
2. **CivicClerk API adapter** (Events + `GetMeetingFileStream(plainText=true)`). Covers Jupiter, Deerfield, Parkland and six smaller PB/Broward towns; text extraction comes free.
3. **Swagit transcript adapter** (`/videos/{id}/transcript`), fed by CivicClerk `externalMediaUrl` or Legistar/AgendaCenter video links. Gives meeting recap text for Jupiter, Parkland.
4. **YouTube Data API** metadata (needs `YOUTUBE_API_KEY`); the only usable video route for Granicus-video cities (Delray, Boca, Boynton, Hollywood, WPB, PBG).
5. **CivicPlus Agenda Center** module in the existing `civicplus` adapter. Checked 2026-10-16 on Hollywood: the list page gives category, meeting date and posted time per row, but the `?html=true` "HTML version" is only a link to the uploaded PDF (2 KB), and minutes are PDFs too, so text needs PDF extraction. No nearby city uses it as its main agenda system; build it with PDF text extraction when a ranked town needs it.
6. eSCRIBE, 7. iQM2 (60 s crawl delay), 8. OnBase Agenda Online, 9. Municode Meetings - outside South Florida; build when a ranked town needs them.
- Do not build: Granicus MediaManager, PrimeGov, AgendaQuick/destinyhosted, BoardDocs. Launcher `detect()` should still recognise them so readiness scores them as blocked.
- Launcher probes (cheap, allowed): Legistar client name via `webapi.legistar.com/v1/{c}/bodies` (500 "not set up" = absent); CivicClerk tenant via `{t}.api.civicclerk.com/v1/Events?$top=1` (DNS failure = absent). Tenant names seen: `delraybeach`, `pompano`, `wellington`, `hollywoodfl`, `ppines`, `margatefl`, `coconutcreek`, `miramar`, `fortlauderdale`, `broward`, `doral`; CivicClerk `jupiterfl`, `deerfieldbeachfl`, `parklandfl`, `palmbeachfl`, `northpalmbeachfl`, `greenacresfl`, `lighthousepointfl`, `daniabeachfl`, `wiltonmanorsfl`.

## 5. Market share
No independent market-share data found. Vendor-reported only: CivicPlus agenda product ~1,500 clerk customers (older page: 4,200); CivicPlus overall 13K+ local governments, all products; Granicus publishes no Legistar count. In this 27-municipality South Florida sample: Legistar 9, CivicClerk 9, Granicus MediaManager-only 2, CMS/Laserfiche/unverified 7; Granicus video tenants exist for at least 12 of them.

## 6. Meeting recaps: one meeting, several stories (2026-10-19)
No paid transcription and no caption scraping (D-M2-4 as amended 2026-10-16). Transcripts come only from what adapters already fetch where robots.txt allows (Swagit, as `transcript:<id>`) and from caption files staff upload.
- **Caption files** (`packages/adapters/src/lib/captions.ts`): WebVTT, SRT, Swagit-style stamped text and plain text into timed cues, with a compact text-position-to-seconds index. Ported from Kyle's TownCore `lib/meetings/vtt.ts`.
- **Admin → Meetings** (`packages/pipeline/src/captions.ts`): past meetings in every town; a `.vtt`, `.srt` or `.txt` file the town published, or the recording's own export (Zoom, Teams), becomes `transcript-upload:<id>` on the meeting's source (never overwritten by an adapter), timed when the file is, and joins any recap not written yet. Audited.
- **Meeting splitter** (`packages/pipeline/src/meeting-split.ts`, prompt `meeting-split@v1`): reads minutes or recorded actions in overlapping 12,000-character parts with an outline of the transcript (agenda markers, times, never its words); code checks every excerpt and vote tally word for word against the records and drops what fails, then confirms or finds each decision's transcript window (agenda marker, then rare words and numbers, scanning the whole transcript; never head/tail truncation). It splits only when 2 or more decisions are newsworthy (at most 4; the parent recap is logged as `duplicate` with the topics), so a meeting is never covered both ways. Each decision is a scored story candidate under the daily budget; the writer and fact-check get the minutes around it and only its transcript window with a margin. A transcript is never the only source, and a story citing one goes to review.
- **Off until recorded**: the `meeting-split` route ships `disabled: true`, so recaps stay one story per meeting and `pnpm evals` replays exactly as before. Evals judge a split meeting on all its decision stories (the real Delray commission actions case). Owner steps, with a model key: `pnpm evals --live --variant meeting-split` (runs the splitter, writes a variant report with its cost, records nothing); if it holds up, delete `disabled` from `taskRoutes['meeting-split']` in `packages/config/src/models.ts` and run `pnpm evals --live` so the baseline recording CI replays includes the split calls.
