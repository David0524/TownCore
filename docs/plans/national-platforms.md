# National platforms: survey and build order

Research for scaling past South Florida (2026-10-16). Goal: find the software platforms that the most US cities, counties and school districts publish on, check each against Rule 8, and pick the next adapters. One adapter per platform (§9).

Companion to `docs/plans/meeting-platforms.md`, which covers agenda and meeting platforms in depth (Legistar, CivicClerk, Swagit, YouTube, CivicPlus Agenda Center, eSCRIBE, iQM2, OnBase Agenda Online, Municode Meetings, Granicus MediaManager, PrimeGov, AgendaQuick, BoardDocs, CivicWeb, NovusAgenda, Laserfiche). Those findings are summarised here, not repeated.

**Method.** Every robots.txt marked "verified" was fetched live today with `TownCoreBot/1.0 (info@towncore.net)`, at least 1.2 seconds apart. Data endpoints were fetched only after their robots.txt allowed them, except as noted under "Process notes". Our Fetcher reads a 4xx robots.txt as "no rules" (RFC 9309) and a 5xx or unreachable one as "disallow all"; the verdicts use the same reading. Prevalence figures are vendor-reported or third-party estimates unless stated otherwise. **Unverified** means it wasn't confirmed live today.

**Process notes (honesty).**
1. `data.boston.gov`: one `GET /api/3/action/package_search` was sent in the same shell command as its robots.txt fetch, before I read that robots.txt, which has `Disallow: /api/`. One request, not repeated. The CKAN verdict below reflects the disallow.
2. `stlucieco.gov`: one page fetch followed a 301 on robots.txt. The `www.stlucieco.gov` robots.txt returns 403, which counts as no rules, so the fetch was allowed in hindsight.
3. `lakeworthbeachfl.gov/wp-json/...`: allowed by robots.txt (it disallows `/api/`, not `/wp-json/`), but Cloudflare returned a 403 challenge page.

---

## 1. Summary table

| Platform | Data | Access path | Robots verdict (verified) | US prevalence | Verdict |
| --- | --- | --- | --- | --- | --- |
| **Socrata / Tyler Data & Insights** | Permits, police incidents, 311, code cases, inspections, budgets (larger cities and states) | SODA API `https://{domain}/resource/{4x4}.json` (SoQL); Discovery API `api.us.socrata.com/api/catalog/v1` | **Allowed.** `/resource/` not disallowed; `Crawl-delay: 1`; `/api/odata/`, `/OData.svc/`, `/browse?…&q=` disallowed | Hundreds of portal domains, mostly large cities, counties and states (unverified count; Tyler bought Socrata in 2018) | **BUILD** |
| **ArcGIS REST (FeatureServer / MapServer)** | Permits, code violations, development projects, crime points, parcels, closures | `{host}/arcgis/rest/services/{svc}/FeatureServer/{n}/query?where=…&f=json`; discovery via `www.arcgis.com/sharing/rest/search` | **Allowed.** `services*.arcgis.com/robots.txt` returns 403 (= no rules); self-hosted servers usually 404; `www.arcgis.com`: `User-agent: *` with no disallow | Very high. Nearly every county and most cities over ~20k people run ArcGIS (estimate) | **BUILD** |
| **ArcGIS Hub open data sites** | Catalog over the same FeatureServers | `{site}.opendata.arcgis.com`, `hub.arcgis.com` | `Crawl-delay: 60`, `/sites/` disallowed | High | Use for discovery only; read the data from FeatureServer |
| **Florida DBPR Hotels & Restaurants** | Food-service inspections (with violations), weekly emergency closures, new food licenses, ownership changes | Bulk XLSX/CSV on `www2.myfloridalicense.com/hr/...` | **Allowed.** `/hr/` not disallowed (only `/wp-admin/`, `/wp-includes/`, `/wp-content/`, `/xmlrpc.php`, `/author/*`) | Statewide FL (every town) | **BUILD** (extend `fl-dbpr`) |
| **WordPress city sites** | City news releases, events | `/wp-json/wp/v2/posts`, `/feed/` | Per site. Miami Beach allowed; Lake Worth Beach allowed by robots but Cloudflare 403 | Common for small towns (no reliable count) | **BUILD** (generic, per-site checks) |
| **eSCRIBE** | Agendas, minutes, video links | JSON `POST /MeetingsCalendarView.aspx/GetCalendarMeetings` | Allowed (only PetalBot blocked) | Hundreds, mostly Canada; some US | **BUILD** (see meeting survey) |
| **iQM2 (Accela Meetings)** | Agendas, minutes | RSS `/Services/RSS.aspx?Feed=Calendar` | Allowed, `Crawl-delay: 60` | Hundreds (unverified) | **BUILD** (Miami) |
| **Tyler EnerGov Citizen Self Service** | Permits, plans, inspections, code cases, business licenses | Undocumented JSON under `/EnerGovProd/SelfService/api/...` | Allowed on `energovweb.capecoral.gov` (robots 404) | 300+ clients by 2018 (Tyler) | **MAYBE** (undocumented API) |
| **Accela Citizen Access (ACA)** | Permits, planning, licenses, code cases | ASP.NET pages `aca-prod.accela.com/{AGENCY}/Cap/CapHome.aspx`; Construct API `apis.accela.com` needs an app registered with the agency | Allowed (robots 404 on `aca-prod.accela.com`) | 900–2,200 agencies (vendor figures conflict) | **MAYBE** |
| **CentralSquare eTRAKiT** | Permits | ASP.NET search forms `/eTRAKiT/` | Allowed (robots 404 on two hosts) | Hundreds (unverified) | **MAYBE** (low) |
| **OpenGov Permitting (ViewPoint Cloud)** | Permits, licenses | `{tenant}.viewpointcloud.com` | **Disallowed** (`User-agent: *` / `Disallow: /`) | Hundreds (unverified) | **SKIP** |
| **OpenGov portal** (budgets, transparency) | Budgets | `portal.opengov.com` | Allowed (all comments) | Thousands (vendor) | SKIP (low news value) |
| **CKAN portals** | Open data catalogs | `/api/3/action/package_search`, resource downloads | **`/api/` disallowed** on data.boston.gov and data.ca.gov | Dozens of US portals (Boston, California, some states) | **MAYBE** (owner decision per portal) |
| **Revize CMS** | City news, calendar, alerts | `calendar.php`, `news_detail_T*_R*.php` (HTML; feeds unverified) | Allowed: robots.txt redirects to a Revize file host that returns 404 | Hundreds of small governments (vendor) | **MAYBE** (HTML adapter) |
| **Granicus OpenCities / govAccess CMS** | City news, pages | HTML; no feed found on wpb.org | Per site; long page-level disallow lists (wpb.org, coralsprings.gov) | Very common (Granicus) | MAYBE (via `page` adapter) |
| **CivicPlus CivicEngage** | News Flash, calendar, Agenda Center, Alert Center | RSS/iCal (already built) | Allowed (standard template) | ~13K local governments across all CivicPlus products (vendor) | Built |
| **Granicus govDelivery** | Email bulletins (city news, police) | Bulletin pages `content.govdelivery.com/accounts/{CODE}/bulletins/{id}` | `public.govdelivery.com`: `Allow: /accounts/`, `Disallow: /`. Listing pages redirect to a login; `bulletins.rss` returned 406 to us | Thousands (vendor) | **SKIP** as a source; follow links to single bulletins from allowed pages |
| **Nixle (Everbridge)** | Police and city alerts | HTML `local.nixle.com/{agency-slug}/`, `/alert/{id}/` | `local.nixle.com` allowed except `/region_search/`, `/agency_search/`; `nixle.com`: `Disallow: /` | Thousands of agencies (unverified); Boca Raton PD left in 2022 | **MAYBE** (low; no feed found) |
| **CrimeMapping.com (CentralSquare)** | Police incident points | Map app | robots 404; terms unverified | ~1,000+ agencies (unverified) | **SKIP** (Tier 3 data; use the agency's own Socrata or ArcGIS feed) |
| **LexisNexis Community Crime Map** | Police incident points | Map app | robots 404 | Many agencies (unverified) | **SKIP** (LexisNexis general terms bar automated access) |
| **PulsePoint** | Live fire/EMS calls | Undocumented, encrypted API | `web.pulsepoint.org` blocks AI crawlers by name (ClaudeBot, GPTBot, …); `*` allowed | 5,000+ communities (unverified) | **SKIP** (terms bar scraping; intent clear) |
| **Finalsite (schools)** | District news, calendar | HTML pages; `/fs/` (calendar and post managers) disallowed apart from listed pages | Palm Beach and Broward districts: `Crawl-delay: 5`, `Disallow: /fs/` with allow-list | 4,000+ US districts (third-party) | **MAYBE** (news pages through `page`; no feed path allowed) |
| **Apptegy / Thrillshare (schools)** | District news, events | HTML `/news`, `/events`, `/article/{id}`; JSON under `/api/` disallowed | `Disallow: /api/` (sdale.org, conwayschools.org) | 5,250+ districts (third-party) | **MAYBE** |
| **Edlio (schools)** | School news, calendars | HTML `/apps/news/`, `/apps/events/` (unverified) | `*.edlioschool.com`: `Disallow: /`; lausd.org robots and pages 403 | ~5,000 sites (third-party) | **MAYBE** (per district) |
| **BoardDocs (Diligent)** | School board agendas | `go.boarddocs.com/{st}/{org}/Board.nsf` | 403 to us (robots and pages) | Thousands of boards (unverified) | **SKIP** |
| **Diligent Community / One Platform** | Board agendas (Palm Beach schools) | `{org}.community.diligentoneplatform.com/Portal/...` | **Disallowed** (`User-agent: *` / `Disallow: /`) | Thousands of boards (unverified) | **SKIP** |
| **Municode Library** | Municipal codes | `library.municode.com/{st}/{place}` | Cloudflare challenge (403) on robots.txt and the API host | ~4,000+ codes (vendor, unverified) | **SKIP** |
| **American Legal / eCode360** | Municipal codes | HTML | Allowed (amlegal blocks only named bots; eCode360 blocks `/search`, `/print`, `/documents`) | Thousands | SKIP (low news value) |
| **Florida DOR tax roll (NAL/SDF)** | Parcels, assessed values, annual sales file | SharePoint library `floridarevenue.com/property/dataportal/...` | Allowed (`*` disallows only `/Forms_library/20*`) | Statewide FL | **MAYBE** (annual, lags a year) |
| **County property appraisers / clerks** | Sales, assessments, deeds | Varies per county | Varies (pbcpao.gov empty robots; web.bcpa.net `Disallow: /*?`) | 3,000+ counties, many vendors | Case by case |
| **Patch and other outlets** | News | n/a | n/a | n/a | **Off-limits as sources** (Rule 3: headline + summary + link only) |

---

## 2. Open data platforms

### 2.1 Socrata (Tyler Data & Insights)
- **What:** Hosted open data portals (`data.{city}.gov` and similar). Larger cities, counties and states publish building permits, police incidents, 311, code enforcement, restaurant inspections and budgets here, often refreshed daily.
- **Prevalence:** No current published count found. Tyler bought Socrata in 2018 for $150M; its customers skew to large jurisdictions and states ([StateScoop](https://statescoop.com/government-data-firm-socrata-is-acquired-by-public-sector-software-giant-tyler-technologies/)). Estimate: low hundreds of US portal domains (unverified).
- **Access:**
  - SODA 2.1: `GET https://{domain}/resource/{dataset-id}.json?$where=…&$order=:updated_at DESC&$limit=N`. CSV via `.csv`. Docs: `https://dev.socrata.com/` (not fetched today). A free app token (`X-App-Token`) raises throttling limits.
  - Discovery API (catalog across every Socrata domain): `GET https://api.us.socrata.com/api/catalog/v1?domains={domain}&q=permit&only=dataset`. Verified: Orlando returns 20 permit datasets, updated today.
  - Metadata: `/api/views/{id}.json` (not disallowed).
- **robots.txt (verified):** `data.cityofchicago.org`, `data.cityoforlando.net`, `data.cityofnewyork.us` and `data.sf.gov` all serve the same template: `User-agent: *`, `Crawl-delay: 1`, disallowing `/browse?…` facets, `/login`, `/OData.svc/`, `/api/odata/`, `/tiles/` and `/api/collocate*`. **`/resource/` is not disallowed.** `api.us.socrata.com/robots.txt` redirects to a 404 (no rules).
- **Verified fetch:** `https://data.cityoforlando.net/resource/ryhf-m453.json?$limit=2&$order=:updated_at DESC` returned Orlando permit applications (permit number, address, contractor, estimated cost, status).
- **Terms:** Each portal sets its own dataset licenses (often public domain or open). Tyler's platform terms were not fetched today (**unverified**).
- **Examples:** Orlando FL `data.cityoforlando.net`; Chicago `data.cityofchicago.org` (food inspections, permits, crimes); NYC `data.cityofnewyork.us`; San Francisco `data.sf.gov`.
- **detect():** the robots.txt `Sitemap:` line contains `socrata-sitemaps`; `X-Socrata-RequestId` response header; `/api/views/` links; HTML mentions `socrata` or "Data & Insights". The launcher can also query the Discovery API by domain.
- **Verdict: BUILD.** One adapter config per dataset: `{domain, datasetId, kind, dateField, idField, titleTemplate}`. Kinds: permits, police (Tier 3), inspections (Tier 3 on failures), code enforcement.

### 2.2 ArcGIS REST services and ArcGIS Hub
- **What:** Esri's GIS server. Counties and cities publish permits, code violations, development applications, crime points, road closures and parcels as FeatureServer or MapServer layers, either on ArcGIS Online (`services{1-9}.arcgis.com/{orgId}/arcgis/rest/services/...`) or on their own servers (`gis.{city}.gov/server/rest/services/...`). Hub sites (`*.opendata.arcgis.com`, `hub.arcgis.com`) are catalogs over the same layers.
- **Prevalence:** The de facto local-government GIS. Most counties and mid-size cities run it (estimate; no count published).
- **Access:**
  - Query: `GET {layer}/query?where={date field} > timestamp 'YYYY-MM-DD'&outFields=*&orderByFields=OBJECTID DESC&resultRecordCount=N&f=json` (or `f=geojson`). Layer metadata: `{layer}?f=json`. Service list: `{orgRoot}/arcgis/rest/services?f=json`.
  - Discovery: `GET https://www.arcgis.com/sharing/rest/search?q={town} type:"Feature Service"&f=json`. Verified: it found Fort Lauderdale's `BuildingPermits` layer and Miami-Dade's permits and violations.
- **robots.txt (verified):**
  - `services.arcgis.com`, `services1.arcgis.com`, `services2.arcgis.com`: HTTP 403 "Invalid URL" (no rules).
  - `gis.fortlauderdale.gov` and `maps.co.palm-beach.fl.us`: 404 (no rules).
  - `www.arcgis.com`: `User-agent: *` with no Disallow.
  - Hub (`hub.arcgis.com`, `gis-mdc.opendata.arcgis.com`): `Crawl-delay: 60`, `Disallow: /sites/ /admin/ /sessions/ /groups/ /people/ /workspace/`. Hub pages are too slow to crawl; use the FeatureServer.
- **Verified fetches:**
  - `https://gis.fortlauderdale.gov/server/rest/services/BuildingPermits/FeatureServer/0/query?where=1%3D1&outFields=*&resultRecordCount=1&orderByFields=OBJECTID%20DESC&f=json` returned permit fields (`PERMITID`, `PERMITTYPE`, `PERMITSTAT`, `PERMITDESC`, `SUBMITDT`, `APPROVEDT`, …).
  - `https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/miamidade_permit_data/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json` returned `{"count":139954}` (Miami-Dade County permits, two years to date).
  - Also found: Miami-Dade `BuildingViolation_gdb`, City of Miami `40_Year_Recertification`, Lee County `NuisanceAccumulationViolations`, Bradenton monthly code-enforcement layers.
  - Boca Raton's AGOL org (`services2.arcgis.com/2Fxt2jfrpqgsZ8Df`) publishes 10 services, none with permits or code cases.
- **Terms:** Each item has its own `licenseInfo` (and the org's terms). The adapter should store it with the source, and the launcher should flag items with restrictive licenses (**unverified** network-wide).
- **detect():** URLs containing `/arcgis/rest/services/`, `arcgis.com`, `opendata.arcgis.com`, `hub.arcgis.com`, `.maps.arcgis.com`; HTML embeds of `arcgis.com/apps/`.
- **Pitfalls:** Field names differ in every layer, so each source config needs a field map (date, id, title, address). Dates are epoch milliseconds. Some layers are snapshots without dates. Paging uses `resultOffset` up to `maxRecordCount`.
- **Verdict: BUILD.** This is the broadest permits, code-enforcement and development source in the country. Pair it with an LLM-assisted field mapper in the launcher (Opus, reviewed by a person).

### 2.3 CKAN
- **What:** Open-source catalog (Boston, California, some states; data.gov ran on CKAN until its 2025 rebuild).
- **robots.txt (verified):** `data.boston.gov`: `Disallow: /api/`, `/datastore/*`; `data.ca.gov`: `Disallow: /api/`, `/datastore/`, `/search?`. `catalog.data.gov`: `Crawl-Delay: 10` and no disallows, but `/api/3/action/package_search` now returns 404 (the API moved; **unverified** where).
- **Verdict: MAYBE.** The API is blocked on the portals checked. Resource download URLs (`/dataset/{x}/resource/{y}/download/...`) may be allowed per site. CKAN's API is documented, but adding a portal to `DOCUMENTED_APIS` needs that portal's own published terms inviting automated use, which is an owner decision per portal. Low priority: few US towns run CKAN.

### 2.4 OpenGov
- **Permitting & Licensing (ViewPoint Cloud):** `wythevilleva.viewpointcloud.com` and `portsmouthnh.viewpointcloud.com` robots: `User-agent: *` / `Disallow: /`. **SKIP.** No Florida tenant found.
- **OpenGov portal** (budgets): `portal.opengov.com` robots is all comments (allowed). Low news value. SKIP.

---

## 3. Permitting and code enforcement

### 3.1 Tyler EnerGov Citizen Self Service (CSS)
- **What:** Permits, plan reviews, inspections, code cases and business licenses. 300+ EnerGov clients across 42 states by 2018 ([Tyler release](https://s201.q4cdn.com/385562537/files/doc_news/2018/07/174777.pdf)). In Florida: Cape Coral, St. Lucie County, Miami Gardens, Destin; West Palm Beach has an EnerGov test layer on AGOL.
- **Access:** an Angular single-page app at `/EnerGovProd/SelfService#/search`, backed by JSON under `/EnerGovProd/SelfService/api/...`. Verified: `GET https://energovweb.capecoral.gov/EnerGovProd/SelfService/api/tenants/gettenantslist` returned JSON (`capecoralflprod`). The permit search is reportedly `POST /api/energov/search/search` with a criteria body (**unverified**). Hosts are city domains or `*.tylerhost.net`.
- **robots.txt:** `energovweb.capecoral.gov` returns 404 (no rules = allowed).
- **Terms:** none published for the API. It's internal to the app, not documented for third parties.
- **detect():** `/EnerGovProd/SelfService`, `tylerhost.net`, "EnerGov" or "Citizen Self Service" in links.
- **Verdict: MAYBE.** Allowed by robots.txt and rich, but undocumented. Many EnerGov cities also push permits to ArcGIS or Socrata, which is the safer route. Owner decision: may we call an app's undocumented JSON when robots.txt allows it?

### 3.2 Accela Citizen Access (ACA)
- **What:** Permits, planning, licensing, code enforcement. Accela reports 900+ agencies; older figures say 2,200+ (figures don't reconcile). In Florida: Key Biscayne (`https://aca-prod.accela.com/keybiscayne/Default.aspx`, verified 200), Martin County, North Port, Lake Buena Vista (Oversight District).
- **Access:** ASP.NET WebForms search (`/Cap/CapHome.aspx?module=Building`) with postbacks and viewstate; no feeds. The Accela Construct API (`apis.accela.com`, docs at developer.accela.com) needs an app ID plus the agency's environment, and citizen-scope access is set by each agency (**unverified** for anonymous use).
- **robots.txt:** `aca-prod.accela.com` 404; `apis.accela.com` 404; `aca3.accela.com` 301.
- **detect():** `aca-prod.accela.com/{AGENCY}`, `/CitizenAccess/`, `/Cap/CapHome.aspx`.
- **Verdict: MAYBE.** Form scraping is brittle. Prefer the agency's ArcGIS or Socrata export where one exists, or ask Accela about API access.

### 3.3 CentralSquare Community Development (eTRAKiT)
- Hosts on city domains, e.g. `permits.rcgov.org/eTRAKiT/` (Rapid City SD) and `etrakit.cityoftracy.org` (Tracy CA). robots.txt 404 on both. ASP.NET search forms; no feed found.
- **detect():** `/eTRAKiT/`, "Powered by CentralSquare".
- **Verdict: MAYBE (low).**

### 3.4 Other permit systems seen (not checked in depth)
CityView (Naples FL, public portal), Citizenserve, iWorQ, SmartGov (Granicus), Cloudpermit. All per-city web apps. Detect them so readiness can count them, but don't build until a ranked town needs one.

---

## 4. City news, alerts and websites

### 4.1 WordPress city sites
- **Access:** `GET /wp-json/wp/v2/posts?per_page=20&_fields=id,date,modified,link,title,content,categories` (plus `?categories=` for the news category), or RSS at `/feed/` and `/category/{slug}/feed/`. The Events Calendar plugin adds `/wp-json/tribe/events/v1/events`.
- **Verified:** `https://www.miamibeachfl.gov/wp-json/wp/v2/posts?per_page=2&_fields=date,link,title` returned 200. Its robots.txt disallows `/?s=`, `/search/` and **`/*.pdf$`**, so the adapter must honor the PDF rule. Lake Worth Beach: robots disallows `/api/`, `/events/`, `/event/` and `?ical=` (not `/wp-json/`), but Cloudflare returns a 403 challenge to our bot, so it's blocked in practice.
- **Caveat:** many "posts" are not news. Miami Beach's newest posts are staff bio pages, so each source needs a category filter.
- **detect():** `<link rel="https://api.w.org/">`, `/wp-content/`, `/wp-json/`.
- **Verdict: BUILD.** A generic `wordpress` adapter: cheap, covers many small towns, police departments and chambers. Per-site robots and WAF checks are already in the Fetcher.

### 4.2 Revize CMS
- Government CMS for small towns. Florida clients named by Revize: St. Petersburg (`stpete.org`), Largo (`largo.com`).
- **robots.txt:** each city's robots.txt redirects cross-host to a Revize file host (`cms5.revize.com/revize/stpete/robots.txt`, `cms7files.revize.com/largoflorida/robots.txt`, `webgen1files1.revize.com/genevany/robots.txt`) that returns 404, so there are no rules. Revize's own `www.revize.com` disallows `*` (vendor marketing site, not relevant).
- **Access:** `calendar.php` (FullCalendar plugin, `?calendar=N`; a JSON endpoint is likely but **unverified**), news pages `news_detail_T{n}_R{n}.php`, alerts `alert_detail_T{n}_R{n}.php`. No RSS found on stpete.org.
- **detect():** `/revize/` asset paths, `revize.com` hosts, `_detail_T\d+_R\d+\.php`.
- **Verdict: MAYBE.** An HTML list adapter is feasible; build when a ranked town uses Revize.

### 4.3 Granicus OpenCities / govAccess (Vision)
- City CMS behind wpb.org and coralsprings.gov. robots.txt files are long page-level lists (Coral Springs disallows `/Agenda` and many announcement pages; WPB disallows several news folders). No RSS link on the wpb.org home page. Several govAccess cities (Sunrise, Plantation) return 403 to our bot.
- **Verdict: MAYBE** through the generic `page` adapter, per site.

### 4.4 Granicus govDelivery
- **robots.txt:** `public.govdelivery.com`: `Allow: /accounts/`, `Allow: /system/images/`, `Disallow: /`. `content.govdelivery.com`: 404 (no rules).
- **Tested:** `content.govdelivery.com/accounts/{CODE}/bulletins` redirects to `/session/new` (login), and `bulletins.rss` returned **406** for USEPA, OHCOLUMBUS and FLDEP, even with an RSS Accept header. Single bulletins (`/accounts/{CODE}/bulletins/{hex}`) are public pages (**unverified** today).
- **Verdict: SKIP** as a listing source. Follow links to single bulletins found on allowed city pages. Subscribing a staff inbox to a city's bulletins (received through SES) is an alternative, but it's an outbound action needing owner approval (Rule 10).

### 4.5 Nixle (Everbridge)
- **robots.txt:** `local.nixle.com`: `User-Agent: *` disallows `/region_search/` and `/agency_search/` only. `nixle.com`: `Disallow: /`.
- **Access:** HTML agency pages `local.nixle.com/{agency-slug}/` (e.g. `/boca-raton-police-services-department/`), ZIP pages `/zipcode/{zip}/`, and alerts `/alert/{id}/`. No RSS or Atom link found.
- **Finding:** Boca Raton PD's last Nixle alerts are from about 4.5 years ago ("Nixle Alerts … are ending March 29th. Sign up NOW for our new alert system at myboca.us/2062/Alert-Boca"). Agencies are moving to Everbridge or CivicReady, which have no public archive.
- Terms on `www.nixle.com/terms-of-service/` were not read (`nixle.com` disallows bots).
- **Verdict: MAYBE (low).** Ages show only relative times ("4 years ago"), and alerts are police content (Tier 3).

### 4.6 Police incident and fire data
- **CrimeMapping.com** (CentralSquare/TriTech): robots 404, terms **unverified**. **LexisNexis Community Crime Map**: LexisNexis general terms prohibit access "via mechanical, programmatic, robotic, scripted or any other automated means" without written permission. **SKIP both.**
- **PulsePoint:** `web.pulsepoint.org` robots.txt names ClaudeBot, GPTBot, anthropic-ai, CCBot and others with `Disallow: /`, then lets `*` in. We aren't named, but the intent to keep AI systems out is explicit. The API is undocumented and encrypted, and the platform terms bar scraping. **SKIP.**
- **Better route:** the agency's own releases (CivicPlus News Flash, WordPress, Socrata or ArcGIS incident layers). Every one of these is Tier 3 or higher under §7.

---

## 5. School districts

| Platform | Districts | robots.txt (verified) | Access | Verdict |
| --- | --- | --- | --- | --- |
| **Finalsite** (Composer; also owns the former Blackboard/Schoolwires K-12 web business, per vendor reports) | Palm Beach County (`palmbeachschools.org`), Broward (`browardschools.com`), Bentonville AR | `User-agent: *`, `Crawl-delay: 5`, `Disallow: /page.cfm`, `Disallow: /fs/` with Allow lines for `/fs/pages/{1-9,news,calendar,athletics,…}`, then hundreds of page exclusions | News is plain pages (`/about-us/news-stories/2025-stories`); calendar and post-manager feeds are under `/fs/` (disallowed) | MAYBE: `page` adapter per district |
| **Apptegy / Thrillshare** | Springdale AR (`sdale.org`), Conway AR | `User-agent: *` / `Disallow: /api/` | HTML `/news`, `/events`, `/article/{id}`; content JSON is under `/api/` (disallowed) | MAYBE: HTML only |
| **Edlio** | LAUSD (marker only) | `*.edlioschool.com`: `Disallow: /`; `lausd.org` robots and home page 403 | `/apps/news/`, `/apps/events/` (unverified) | MAYBE: per district |
| **SchoolMessenger Presence** | none verified | unverified | unverified | Unverified |
| **Miami-Dade** (`dadeschools.net`, custom) | Miami-Dade | `User-agent: *`, sitemap only | per page | `page` adapter |
| **BoardDocs** | Palm Beach board (legacy link `go.boarddocs.com/fl/palmbeach/board.nsf`) | 403 to us | none | SKIP |
| **Diligent Community / One Platform** | Palm Beach board (`palmbeachschools-org.community.diligentoneplatform.com/Portal/MeetingTypeList.aspx`) | `User-agent: *` / `Disallow: /` | none | SKIP |
| **Simbli (eBoard Solutions)** | common in GA/FL (unverified) | `simbli.eboardsolutions.com` robots redirects (302); not resolved | unverified | Unverified |

Prevalence (third-party, rough): Finalsite 4,000+ US districts; Apptegy 5,250+ districts; Edlio ~5,000 school and district sites. School board agendas are mostly behind BoardDocs or Diligent, which are blocked, so school-board coverage will lean on district news pages and YouTube meeting video.

**detect():** Finalsite: `/fs/` paths, `resources.finalsite.net`, `page.cfm`. Apptegy: `cmsv2-assets.apptegy.net`, `thrillshare`. Edlio: `edlio` in assets, `/apps/news/`. BoardDocs: `go.boarddocs.com/{st}/{org}/Board.nsf`. Diligent: `diligentoneplatform.com`, `diligent.community`.

---

## 6. Inspections, property and codes

### 6.1 Restaurant and health inspections
- **Florida DBPR Hotels & Restaurants (verified, allowed):** the page `https://www2.myfloridalicense.com/hotels-restaurants/public-records/` links:
  - Fiscal-year inspection files with violations: `/hr/inspections/fdinspi_{yy}{yy}.xlsx` (e.g. `fdinspi_2526.xlsx`, 48.8 MB, last modified 2026-07-07; FY runs July–June, so the current-year file may appear late).
  - Weekly emergency closures: `/hr/inspections/documents/EOS_Weekly_Extract_YYYY-MM-DD.xlsx` (latest `2026-10-11`, modified 2026-10-13).
  - New food licenses: `/hr/licensing/documents/newfood_{yy}{yy}.xlsx`. Ownership changes: `change-owner-food_{yy}{yy}.xlsx`.
  - Extracts: `/sto/file_download/extracts/...csv` (our existing adapter's path).
  - Layout descriptions are linked on the same page. A ReadMe/Disclaimer applies; the page says to review it before downloading.
- **Other states (characterised, not verified today):** many big cities publish inspections on Socrata (Chicago food inspections, NYC DOHMH restaurant grades, King County WA). County health departments often use vendor portals: Digital Health Department (`inspections.myhealthdepartment.com`, whose robots.txt returned 403 to us, so no rules but probably WAF-blocked), Hedgehog, EnvisionConnect, Accela. Most states have no statewide bulk file, unlike Florida.
- **Verdict: BUILD** (extend `fl-dbpr` with an `inspections` kind). Weekly emergency closures and failed inspections are Tier 3 (§7, inspection failures). New food licenses feed "New places to eat" (Tier 1).

### 6.2 Property sales and assessments
- **Florida DOR (verified):** `https://floridarevenue.com/property/dataportal/Pages/default.aspx`, SharePoint folder `PTO Data Portal/Tax Roll Data Files/{NAL,NAP,NAV,SDF}`, with `SDF/2026P` and `SDF/2026F` subfolders. robots.txt: `User-agent: *` disallows only `/Forms_library/20*` (stricter groups apply only to PowerMapper and SortSite). SDF is the statewide sales data file, but annual (preliminary and final rolls), so sales show up months to a year late. Good for year-in-review and backfill, not news. **MAYBE.**
- **County property appraisers:** Palm Beach (`pbcpao.gov`, empty robots.txt = allowed; search is form-driven), Broward (`web.bcpa.net`: `Disallow: /*?`, which blocks query-string searches), Miami-Dade (`www.miamidade.gov` robots 404; its parcel and sales layers are on ArcGIS). Vendors and layouts differ per county. Prefer the county's ArcGIS parcel or sales layer (§2.2) and treat each county as one source config.
- **Clerks (deeds, official records):** daily and timely, but every county runs a different vendor's search app (Landmark Web, OnCore and others; **unverified**), often with captchas. Case by case; owner review needed because deeds name private individuals (Tier 3).

### 6.3 Municipal codes
- **Municode Library:** `library.municode.com` and `api.municode.com` return a Cloudflare "Just a moment..." challenge (403) even for robots.txt. **SKIP.**
- **American Legal** (`codelibrary.amlegal.com`): blocks named bots only, so we're allowed. **eCode360:** allowed except `/search`, `/print`, `/documents`, `/attachment`, `/archives`. Low news value: ordinance changes reach us through agendas. **SKIP for now.**

### 6.4 Other outlets (Patch and others)
Off-limits as sources (Rule 3). Headline plus a one-line summary in our own words plus a link only. Not fetched.

---

## 7. Meeting platforms (from `meeting-platforms.md`)

| Platform | Verdict |
| --- | --- |
| Legistar Web API, CivicClerk, Swagit, YouTube Data API, CivicPlus | Built |
| eSCRIBE (`pub-{t}.escribemeetings.com`, JSON calendar) | BUILD |
| iQM2 (`{t}.iqm2.com/Services/RSS.aspx?Feed=Calendar`, `Crawl-delay: 60`) | BUILD |
| OnBase Agenda Online (`*.hylandcloud.com/{n}agendaonline/`) | BUILD later (HTML) |
| Municode Meetings (`{t}.municodemeetings.com`, `Crawl-delay: 15`) | Low |
| CivicPlus Agenda Center | Extend `civicplus` when a town needs it (PDF text) |
| Granicus MediaManager, PrimeGov, AgendaQuick (`public.destinyhosted.com`), BoardDocs, Diligent Community | SKIP (robots disallow or 403); `detect()` should still recognise them so readiness counts them as blocked |
| CivicWeb (iCompass), NovusAgenda | Unverified / legacy |

---

## 8. Recommended build order (next ~8 adapters)

1. **`socrata`**: SODA `/resource/{id}.json` plus the Discovery API for launcher discovery. One adapter covers permits, police, code and inspections for most large cities and many states. Allowed (`/resource/` not disallowed, `Crawl-delay: 1`, which our 1 req/s cap already meets). Config: domain, dataset id, kind, date/id/title fields.
2. **`arcgis`**: FeatureServer `query`, plus ArcGIS Online search in launcher discovery. The broadest US source for permits, code violations, development and parcels (e.g. Fort Lauderdale permits, Miami-Dade permits and violations). Allowed on the hosts checked. Needs a per-layer field map, which the launcher proposes and a person approves.
3. **`fl-dbpr` inspections kind**: weekly emergency closures, the fiscal-year inspection file and new food licenses. Statewide Florida, allowed, and already our platform. Feeds Tier 3 inspection stories and the dining directory.
4. **`wordpress`**: `/wp-json/wp/v2/posts` with a category filter, falling back to `/feed/`. Cheap; covers small-town news, police departments and chambers. Honor per-site rules such as Miami Beach's `/*.pdf$`.
5. **`escribe`**: calendar JSON plus `Meeting.aspx` HTML agendas. Allowed; covers Gainesville and other Florida and US cities (from the meeting survey).
6. **`iqm2`**: RSS calendar plus meeting detail (City of Miami). Allowed with a 60-second crawl delay, which the Fetcher already honors.
7. **`revize`**: news and calendar HTML lists (St. Petersburg, Largo and many small towns). Allowed (robots.txt resolves to a 404). Confirm a JSON calendar endpoint first.
8. **`onbase-agenda`** (Hyland Agenda Online, Tampa) or **`energov`**, depending on the owner's decision on undocumented app JSON (§3.1). EnerGov would add permits and code cases for Cape Coral, St. Lucie County and other Tyler cities whose data isn't on ArcGIS or Socrata.

**Detect-only (no fetch adapter; readiness counts them as blocked or unsupported):** ViewPoint Cloud, PrimeGov, Granicus MediaManager, AgendaQuick, BoardDocs, Diligent Community, Municode Library, PulsePoint, LexisNexis Community Crime Map, govDelivery listings.

**Owner decisions flagged:**
- (a) May we call undocumented JSON (EnerGov CSS, Accela ACA internals) when robots.txt allows it?
- (b) CKAN portals that disallow `/api/` but publish API docs: add each to `DOCUMENTED_APIS` only if its own terms invite automated access.
- (c) Florida DOR SDF as an annual backfill source.
- (d) Subscribing a staff inbox to city govDelivery bulletins (Rule 10).
