# Public data sources: Rule 8 check

Research for new beats beyond meetings, licenses and weather (2026-10-17). Seventeen candidate sources, each checked against Rule 8 from this machine with `TownCoreBot/1.0 (info@towncore.net)`. First town: Boca Raton (place FIPS 1207300), Palm Beach County (12099).

**Method.** robots.txt was fetched live for every host, and data was fetched only where robots.txt allowed it. Our Fetcher reads a 4xx robots.txt as "no rules" (RFC 9309) and a 5xx or unreachable one as "disallow all"; the verdicts use the same reading. Requests to one host were at least 1.5 seconds apart, and 10 or 60 seconds where a Crawl-delay asked for it. Small samples are in `docs/research/samples/public-data/`. **Unverified** means it wasn't confirmed live today.

**Process notes (honesty).**
1. Hosts whose robots.txt disallows us (`api.bls.gov`, `api.open.fec.gov`, `echodata.epa.gov`) were not called for data. They are candidates for `DOCUMENTED_APIS`, which only the owner can approve.
2. `download.bls.gov`: one `curl -r` range request was ignored by the server, so the whole `la.series` file (4 MB) was downloaded once and discarded.
3. `edudata.fldoe.org/api/...` answered `400 "Invalid Path"` until the request carried the report-card page as `Referer` (and `X-Requested-With`). robots.txt allows the path, but this is a soft gate; see section 6.
4. Terms and documentation pages on `www.census.gov`, `www.epa.gov`, `www.dol.gov`, `api.data.gov`, `www.weather.gov` and GitHub were read once each by hand, without checking those hosts' robots.txt first. This was reading, not ingest; no adapter would fetch them.

---

## 1. Summary table

| # | Source | Access path | Robots verdict (verified) | Key / limit | Boca granularity | Cadence | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | USASpending | `POST api.usaspending.gov/api/v2/search/spending_by_award/` | **Allowed** (robots 404) | None; no published limit found | Place of performance city, ZIP, county; recipient city | Daily (unverified) | **Adopt now (allowed by robots).** Beware HQ coding |
| 2 | Census ACS API | `api.census.gov/data/{yr}/acs/acs5` | Allowed (robots URL returns a WAF page, no rules) | **Key now required on every call** (302 to `missing_key.html`) | Place, ZCTA, county, tract | Yearly | **Needs owner key** (free). Or keep using `www2.census.gov` bulk files, already allowlisted |
| 3 | BLS LAUS | API `api.bls.gov`; bulk `download.bls.gov/pub/time.series/la/` | API **disallowed** (`Disallow: /`); bulk **allowed** (robots 404) | API v1 keyless 25 queries/day; v2 key 500/day | **Boca city** (CT1207300) and county | Monthly | **Adopt now (allowed by robots)** via the bulk file; API needs owner approval and key |
| 4 | EIA gasoline prices | API `api.eia.gov/v2`; pages `www.eia.gov/dnav/pet/` | API host: no rules (403 JSON); `www.eia.gov/dnav/` **allowed** | API key required (free) | **Florida** state series; Miami city; PADD 1C | Weekly (Monday) | **Adopt now (allowed by robots)** via the dnav page; API needs owner key |
| 5a | Boca development projects (city ArcGIS) | `bocagis.ci.boca-raton.fl.us/gisweb/rest/services/Development/InfrastructureAlerts/MapServer/{0-3}/query` | **Allowed** (robots 404) | None | City, by address | Unknown (no edit dates) | **Adopt now (allowed by robots)**, existing `arcgis` platform |
| 5b | Boca budget, checkbook, bids | Budget PDFs on myboca.us; bids on `brpurch.ionwave.net` | myboca allowed; IonWave **disallowed** (`Disallow: /`) | n/a | City | Yearly (budget) | No open checkbook or open-data portal found. Don't use IonWave or ClearGov |
| 5c | Palm Beach County open data | Hub `opendata2-pbcgov.opendata.arcgis.com`; data on `maps.co.palm-beach.fl.us` | Hub: `Crawl-delay: 60`, `/sites/` disallowed; ArcGIS server allowed | None | County, parcel | Varies | Already in `counties/fl/palm-beach.yaml`; use the hub for discovery only |
| 6 | FLDOE school grades, enrollment | `edudata.fldoe.org/api/RCContent/...` (report card JSON) | `www.fldoe.org` 403 to our bot; `edudata.fldoe.org` **allowed** | None, but needs the page as `Referer` | School, district | Yearly (July) | **Owner decision**: undocumented endpoint behind a Referer check |
| 7 | CMS Provider Data Catalog | `data.cms.gov/provider-data/api/1/datastore/query/{id}/0` | **Allowed**, `Crawl-delay: 10` | None | Facility (city, ZIP) | Monthly | **Adopt now (allowed by robots)** |
| 8 | EPA ECHO | REST `echodata.epa.gov/echo/...`; bulk `echo.epa.gov/files/echodownloads/` | REST **disallowed** (`Disallow: *`); bulk **allowed**, `Crawl-delay: 10` | None | Facility (city, ZIP) | Weekly | REST needs owner approval for `DOCUMENTED_APIS`; bulk is allowed but 392 MB |
| 9 | OSHA enforcement | `apiprod.dol.gov/v4/get/OSHA/...` | Allowed (robots 403 = no rules); `www.osha.gov` 403 to our bot | **Key required** (401 without) | Establishment (city, ZIP) | Daily (unverified) | **Needs owner key/sign-up** (dataportal.dol.gov) |
| 10a | FEC API | `api.open.fec.gov/v1/...` | **Disallowed** (`Disallow: /v1/*`) | api.data.gov key; DEMO_KEY 30/hour, 50/day | Contributor city, ZIP | Daily | Needs owner approval (`DOCUMENTED_APIS`) and key |
| 10b | Florida campaign finance (state races) | `dos.elections.myflorida.com/cgi-bin/contrib.exe` (tab-delimited) | **Allowed** (robots 404) | None | Contributor city, ZIP | As filed | **Adopt now (allowed by robots)**, aggregates only |
| 10c | Palm Beach SOE (local races) | `votepalmbeach.gov` | **Blocked** (Cloudflare 403 on robots) | n/a | n/a | n/a | Don't use; ask the SOE or use email bulletins |
| 11 | FAA OPSNET/ATADS (BCT operations) | `www.aspm.faa.gov/opsnet/sys/Airport.asp` (form POST) | Allowed (robots 404); `www.faa.gov` and `registry.faa.gov` 403 to our bot | None | Airport | Monthly | Low priority. Form-driven; not tried |
| 12 | National Hurricane Center | `www.nhc.noaa.gov/index-at.xml`, `gtwo.xml`, `CurrentStorms.json` | **Allowed** (`Disallow:` empty) | None | Atlantic basin | Every advisory (3–6 h) | **Adopt now (allowed by robots)** |
| 13 | Florida 511 / FDOT | `fl511.com` | `/list/GetData/` **disallowed** | No public developer API found | Road segment | Live | **Don't use**: "personal purposes only (and specifically excluding any commercial use)" |
| 14 | PBC Commission agendas, news | `discover.pbc.gov/countycommissioners/Pages/Agenda.aspx` → `www.pbcgov.com/pubInf/Agenda/{YYYYMMDD}/{YYYYMMDD}.pdf` | **Allowed** (`/Lists/` disallowed) | None | County | Per meeting (twice a month) | **Adopt now (allowed by robots)** for agendas (`pdf-list`); news releases aren't readable (401 / `/Lists/`) |
| 15a | Boca Raton Police and Fire releases | `www.myboca.us/m/newsflash?cat=17` (police), `cat=37` (fire) | **Allowed** | None | City | About monthly | **Adopt now (allowed by robots)**; Tier 3 |
| 15b | PBSO releases | `www.pbso.org/wp-json/wp/v2/posts` | **Allowed** | None | County; "Boca Raton" tag is stale | Weekly | **Adopt now (allowed by robots)** for county-wide; Tier 3 |
| 16 | CourtListener (S.D. Fla.) | `www.courtlistener.com/api/rest/v4/` | Unknown: CloudFront 403 on robots.txt for any UA; API answers 429 without a token | Token; 125 requests/day by default | Case | Live | **Needs owner sign-up**, probably a paid commercial agreement; Tier 3 |
| 17 | Florida DOR NAL/SDF | `floridarevenue.com/property/dataportal/Documents/PTO Data Portal/Tax Roll Data Files/{NAL,SDF}/{year}{P,F}/...zip` | **Allowed** (only `/dor/*`, `*/Lists/*` and seasonal paths disallowed for `*`) | None | Parcel (county files) | Yearly (preliminary July, final after October) | **Adopt now (allowed by robots)**, owner approved 2026-10-16; SDF only, never NAL owner columns |

**Candidates for `DOCUMENTED_APIS` (owner approval needed):** `api.bls.gov`, `api.open.fec.gov`, `echodata.epa.gov`. None is needed today: BLS and ECHO have allowed bulk files, and FEC has nothing local.

---

## 2. Sources

### 1. USASpending.gov

- **Endpoint:** `POST https://api.usaspending.gov/api/v2/search/spending_by_award/` with JSON filters. Sample: contracts (`award_type_codes` A–D) since 2026-07-01 with `place_of_performance_locations: [{country: USA, state: FL, city: "Boca Raton"}]`, top 5 by amount. Also filter by `recipient_locations`, ZIP or county (`county: "099"`).
- **Robots:** `api.usaspending.gov/robots.txt` returns 404 (no rules). Allowed. (`www.usaspending.gov` disallows `/*?*` and `/*.php*`; we don't need it.)
- **Terms:** federal data; the API's code is CC0 ("voluntarily elects to apply CC0 to the Work"). The docs pages are JavaScript-only; no rate limit was found (unverified).
- **Key:** none.
- **Granularity:** place of performance and recipient city, ZIP, county, congressional district.
- **Cadence:** contracts within days of award (unverified).
- **Sample:** `usaspending-boca-contracts.json`.
- **Caution (surprising):** the top results for "Boca Raton" are GEO Group detention contracts performed in California and elsewhere, coded to ZIP 33431 because the company's headquarters is there. A story must say "awarded to a Boca Raton company", never "spent in Boca Raton", and must read the description. Assistance awards to individuals are redacted by the source; facility and company names are fine.
- **Recommendation:** adopt now (allowed by robots). Weekly roundup of awards to Boca-based recipients, Tier 1–2.

### 2. Census ACS API

- **Endpoint:** `https://api.census.gov/data/2024/acs/acs5?get=NAME,B01003_001E,B19013_001E&for=place:07300&in=state:12&key=...`
- **Robots:** the robots.txt URL returns an F5 "Request Rejected" HTML page with status 200. It has no rules, so the Fetcher reads it as allowed.
- **Key (surprising):** every call without a key now answers `302` to `/data/missing_key.html` with header `X-DataWebAPI-KeyError: 1`: "A valid key must be included with each data API request." The old keyless allowance (500 a day) is gone.
- **Terms:** <https://www.census.gov/data/developers/about/terms-of-service.html>. Services "should display the following notice prominently within the application: 'This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau.'" Overuse may be "temporarily or permanently blocked".
- **Granularity:** place (Boca 1207300), ZCTA, county, tract.
- **Cadence:** 1-year estimates in September, 5-year in December.
- **Recommendation:** needs owner key (free; already planned as D-M7-1). For yearly numbers, `www2.census.gov` ACS summary files (allowlisted, keyless) do the same job without the attribution line.

### 3. BLS LAUS (local unemployment)

- **Endpoints:** API `POST https://api.bls.gov/publicAPI/v2/timeseries/data/` with series IDs. Bulk: `https://download.bls.gov/pub/time.series/la/la.data.16.Florida` (21 MB, every Florida county and large city).
- **Series:** Boca Raton city `LAUCT1207300000000{03,04,05,06}` (rate, unemployed, employed, labor force); Palm Beach County `LAUCN120990000000003`; metro division `DV1248424000000`.
- **Robots:** `api.bls.gov` and `data.bls.gov`: `Disallow: /`. `download.bls.gov`: 404 (no rules), allowed. `www.bls.gov`: only admin and print paths disallowed.
- **Terms:** <https://www.bls.gov/opub/copyright-information.htm>: "You are free to use our public domain material without specific permission, although we do ask that you cite the Bureau of Labor Statistics as the source." API terms: <https://www.bls.gov/developers/termsOfService.htm>.
- **Limits:** v1 unregistered 25 queries a day, 25 series, 10 years; v2 registered 500 a day, 50 series, 20 years; 50 requests per 10 seconds.
- **Cadence:** monthly; the files dated 2026-09-30 carry August 2026 as preliminary (Boca 4.8%).
- **Sample:** `bls-laus-boca.json`.
- **Recommendation:** adopt now (allowed by robots) through the bulk file and the shared file cache (one download per state a month). The API would need a `DOCUMENTED_APIS` entry and a key; not needed.

### 4. EIA retail gasoline prices

- **Series:** Florida regular `EMM_EPMR_PTE_SFL_DPG` (also all grades, midgrade, premium); Miami city `EMM_EPMR_PTE_YMIA_DPG`; Lower Atlantic (PADD 1C) `EMM_EPMR_PTE_R1Z_DPG`. Florida and Miami both exist, so Boca can use the state series, with Miami as the nearest city.
- **Endpoints:** API v2 `https://api.eia.gov/v2/seriesid/PET.EMM_EPMR_PTE_SFL_DPG.W?api_key=...`. Keyless: the table page `https://www.eia.gov/dnav/pet/pet_pri_gnd_dcus_sfl_w.htm` (6 weeks) and its history links (`/dnav/pet/hist/LeafHandler.ashx?n=PET&s=...&f=W`).
- **Robots:** `api.eia.gov/robots.txt` answers 403 with `API_KEY_MISSING` JSON (no rules). `www.eia.gov` allows `/dnav/` and `/petroleum/gasdiesel/`; it disallows `/rss`, `/reports/`, `/archive/` and others.
- **Terms:** <https://www.eia.gov/about/copyrights_reuse.php>: "U.S. government publications are in the public domain and are not subject to copyright protection." API programs "must throttle the number of the requests they make per second and per hour" (documentation page). Rows are capped at 5,000 per call.
- **Key:** required for the API (free registration).
- **Cadence:** weekly, Monday data, published Monday or Tuesday. Latest: Florida regular $3.982 for the week of 2026-10-12.
- **Sample:** `eia-gasoline-florida.json` (copied from the table page).
- **Recommendation:** adopt now (allowed by robots) from the dnav page, or the API once the owner registers a key. A weekly gas-price line fits the Today tile or newsletter.

### 5. Boca Raton and Palm Beach County open data

**5a. Boca development projects (best find).** The city's own ArcGIS Server has `Development/InfrastructureAlerts/MapServer` with four layers: 0 Proposed (30 rows), 1 Approved, not built (62), 2 Under construction (39), 3 Completed (12). Fields include project name, address, description, zoning, case file number, units, height, CRA flag and status.
- **Example:** `GET https://bocagis.ci.boca-raton.fl.us/gisweb/rest/services/Development/InfrastructureAlerts/MapServer/0/query?where=1=1&outFields=PROJECT,FULLADDR,DESCRIPTION,ZONING,CASE_FILE_NUM,UNITS,BUILD_HEIGHT,STATUS&returnGeometry=false&f=json` (for example "Mizner Plaza: 12-story, 242-room hotel and 34,300 sf retail").
- **Robots:** `bocagis.ci.boca-raton.fl.us/robots.txt` 404 (no rules). Allowed.
- **Terms:** none published (unverified). Public records under Fla. Stat. ch. 119.
- **Cadence:** unknown; `LASTUPDATE` is empty, so detect changes by content hash and by a project moving between layers (proposed → approved → under construction).
- **Caution:** a few rows are single-family homes (for example a coastal variance for one house). Name projects and addresses, never owners; treat a private home as Tier 3 or skip it.
- **Sample:** `boca-development-projects.json`.
- **Recommendation:** adopt now (allowed by robots) with the `arcgis` platform. Strong development beat: "new proposal filed", "approved", "construction started".

**5b. Budget, checkbook, bids.** No Socrata, ArcGIS Hub, OpenGov or open checkbook was found for Boca. Budget books are PDFs at `myboca.us/411/Budget-Reports`, plus an ArcGIS "GIS Gallery" app. The ArcGIS Online org `BocaRatonGIS` has 65 public services, mostly flood maps, parcels and city limits. Bids live on `brpurch.ionwave.net`, whose robots.txt is `Disallow: /`: don't use. ClearGov has a Boca profile page, but it's a vendor's rework of state filings, not a primary source: don't use.

**5c. Palm Beach County.** The ArcGIS Hub (`opendata2-pbcgov.opendata.arcgis.com`) asks `Crawl-delay: 60` and disallows `/sites/`; use it for discovery only. The data sits on `maps.co.palm-beach.fl.us` (robots 404), already in `counties/fl/palm-beach.yaml`. No county checkbook was found (unverified).

### 6. Florida DOE school grades, enrollment, tests

- **Hosts:** `www.fldoe.org` answers 403 (Akamai "Access Denied") even for robots.txt, so its spreadsheets (school grades, assessment results) are out of reach. `knowledgebase.fldoe.org` doesn't resolve (proxy 502). `edudata.fldoe.org` (the public report cards) allows everything except a few page fragments.
- **Endpoint (undocumented):** `GET https://edudata.fldoe.org/api/RCContent/GetBase/{district}{school}` (Palm Beach is `50`, district level `500000`). Siblings: `GetEnrollment`, `GetComponents`, `GetParticipation`, and `/api/GapData/...`. Returns grade, components and address per school and year.
- **Gate:** without the report-card page as `Referer` it answers `400 "Invalid Path"`. Sending the page's Referer is what a browser does, but it's a soft gate, so it needs an owner call under decision (a) of 2026-10-16 (undocumented read endpoints allowed when robots.txt allows them).
- **Terms:** none found on edudata (unverified).
- **Granularity:** school and district; schools are named, students never.
- **Cadence:** yearly; school grades in July (the sample has 2025-26: Palm Beach district grade A).
- **Sample:** `fldoe-report-card-palm-beach.json`.
- **Recommendation:** owner decision. Alternative: ask FLDOE to allow our User-Agent on `www.fldoe.org` (the Akamai block also stops the robots.txt check).

### 7. CMS Care Compare / Provider Data Catalog

- **Endpoint:** `GET https://data.cms.gov/provider-data/api/1/datastore/query/{datasetId}/0?conditions[0][property]=citytown&conditions[0][value]=BOCA RATON&conditions[0][operator]==&...`. Datasets: nursing home provider information `4pq5-n9py` (star ratings, health inspection rating, deficiencies, fines, abuse icon), hospital general information `xubh-q36u` (overall star rating). Penalties and health deficiencies have their own datasets (IDs not checked).
- **Robots:** allowed; `crawl-delay: 10`; only `/data-api/v1/download-request` and admin paths disallowed.
- **Terms:** federal data, `accessLevel: public` in the dataset metadata. The docs pages are JavaScript-only; no key or rate limit is stated (unverified).
- **Granularity:** facility, with city and ZIP. Boca has 11 nursing homes and 2 hospitals by mailing city; West Boca Medical Center is in 33428 (unincorporated), so use the city-limits check.
- **Cadence:** monthly (`processing_date` 2026-09-01; metadata modified 2026-09-30).
- **Sample:** `cms-nursing-homes-boca.json`.
- **Caution:** facility names are fine. Inspection deficiencies and fines are accusatory, so Tier 3 (inspection failures).
- **Recommendation:** adopt now (allowed by robots).

### 8. EPA ECHO

- **REST:** `echodata.epa.gov/echo/echo_rest_services.get_facilities?p_zip=...` and the other ECHO web services. `echodata.epa.gov/robots.txt` is `User-agent: * / Disallow: *`. Not called.
- **Bulk:** `https://echo.epa.gov/files/echodownloads/echo_exporter.zip` (392 MB, every regulated facility, weekly) and per-program files (ICIS-Air 64 MB and others). `echo.epa.gov` allows `/files/` with `Crawl-delay: 10`.
- **Terms:** <https://echo.epa.gov/tools/web-services> describes the services but no reuse terms. EPA's disclaimer says geospatial data "is by default in the public domain"; its "non-commercial" wording covers documents, not data.
- **Granularity:** facility with city and ZIP.
- **Cadence:** weekly.
- **Recommendation:** the bulk file is allowed by robots but large; through the shared file cache it's one download a week for the whole country. The REST service would need the owner to add `echodata.epa.gov` to `DOCUMENTED_APIS`. Violations are Tier 3.

### 9. OSHA enforcement

- **Endpoint:** `https://apiprod.dol.gov/v4/get/OSHA/inspection/json?...&X-API-KEY=...`. Without a key: `401` "The API key is either incorrect or missing". `enforcedata.dol.gov` now redirects to `data.dol.gov`, a JavaScript app.
- **Robots:** `data.dol.gov` disallows only `/static/`; `apiprod.dol.gov` answers 403 JSON (no rules); `www.osha.gov` answers CloudFront 403 to our bot, so the OSHA establishment search is out.
- **Terms:** <https://www.dol.gov/general/aboutdol/copyright>: "content on this website which is in the public domain may be used without the prior permission of the U.S. Department of Labor."
- **Key:** free sign-up at dataportal.dol.gov.
- **Granularity:** establishment with city and ZIP.
- **Caution:** inspection records name employers (fine) but can include complaint details and injured workers in accident narratives; never print those. Tier 3.
- **Recommendation:** needs owner key/sign-up.

### 10. Campaign finance

**10a. FEC API.**
- `api.open.fec.gov/robots.txt`: `Disallow: /v1/*`. Not called.
- **Key:** api.data.gov key, default 1,000 requests an hour; `DEMO_KEY` 30 an hour and 50 a day per IP (<https://api.data.gov/docs/developer-manual/>).
- **Privacy rule (important):** the law "prohibits the sale or use of any information about those donors, including their names and addresses, for the purpose of soliciting contributions or for commercial purposes", but "the restriction does not apply to the use of individual contributor information in newspapers, magazines, books or similar communications, as long as the principal purpose of the communication is not to solicit contributions or conduct commercial activity" (<https://www.fec.gov/updates/sale-or-use-contributor-information/>). News use is allowed; never feed donor names into the directory, outreach or any list.
- **Recommendation:** needs owner approval (`DOCUMENTED_APIS`) and a key. Low local value (federal races only).

**10b. Florida Division of Elections.**
- **Endpoint:** `GET https://dos.elections.myflorida.com/cgi-bin/contrib.exe?election=20261103-GEN&search_on=1&ccity=Boca+Raton&cstate=FL&cdatefrom=10/01/2026&rowlimit=5&queryformat=2` (plus the form's empty fields) returns tab-delimited rows: committee, date, amount, contributor name, street address, city/ZIP, occupation. Expenditures and other searches use the same CGI style.
- **Robots:** `dos.elections.myflorida.com` 404; `dos.fl.gov` 404 (no rules). Allowed.
- **Terms:** the page says only that the data is "provided as a convenience to the public" and should be cross-checked with the filed report. No reuse restriction found.
- **Scope:** state candidates and committees only. City races file with the Boca City Clerk and county races with the Supervisor of Elections.
- **Privacy:** contributors are private individuals with home addresses. Publish totals by committee and by city or ZIP; name only candidates, committees, and businesses or PACs as donors. The saved sample has names and addresses redacted.
- **Sample:** `fl-elections-contributions-boca.json`.
- **Recommendation:** adopt now (allowed by robots), aggregates only, Tier 2.

**10c. Palm Beach County SOE.** `www.votepalmbeach.gov/robots.txt` returns a Cloudflare "Sorry, you have been blocked" page (403, served by the CivicPlus platform). Don't use. Local candidate reports would need the SOE's permission or the city clerk.

### 11. FAA data for Boca Raton Airport (BCT)

- **OPSNET/ATADS:** `https://www.aspm.faa.gov/opsnet/sys/Airport.asp` is a public form that POSTs to `opsnet-server-x.asp` (no login). `www.aspm.faa.gov/robots.txt` 404 (no rules). BCT has a tower, so monthly operations counts should be there (unverified; the form wasn't submitted).
- **FAA registry and faa.gov:** `registry.faa.gov` and `www.faa.gov` answer Akamai 403 to our bot. Not usable. Registry data also names private aircraft owners.
- **BTS T-100:** `www.transtats.bts.gov/robots.txt` returns a 404 page (no rules). BCT has no scheduled airline service, so T-100 likely has little or nothing for it (unverified).
- **Recommendation:** low priority. A monthly "airport operations" line is possible from OPSNET once someone maps the form.

### 12. National Hurricane Center

- **Endpoints:** `https://www.nhc.noaa.gov/index-at.xml` (Atlantic basin RSS: outlook and active storms), `https://www.nhc.noaa.gov/gtwo.xml` (Tropical Weather Outlook), `https://www.nhc.noaa.gov/CurrentStorms.json` (active storms with position and intensity; today Hurricane Trudy in the eastern Pacific).
- **Robots:** `User-agent: * / Disallow:` (empty). Allowed.
- **Terms:** <https://www.weather.gov/disclaimer>: NWS information "is in the public domain, unless specifically noted otherwise, and may be used without charge for any lawful purpose", provided we don't claim it as our own, imply endorsement, or modify it and present it as official. NHC's RSS page invites feed readers to "check for new feeds on a recurring basis, generally once an hour or so".
- **Granularity:** basin and storm; local impact comes from the NWS alerts we already read (FLZ168).
- **Cadence:** advisories every 6 hours (3 when watches are up).
- **Sample:** `nhc-index-at.xml` ("There are no tropical cyclones at this time").
- **Recommendation:** adopt now (allowed by robots). One fetch per run serves every coastal town (shared, like weather).

### 13. Florida 511 / FDOT lane closures

- **Robots:** `fl511.com` disallows `/list/getdata/`, `/map/map*/`, `/eventdetails/` and `/my511/`, so the list pages' data calls are off-limits.
- **API:** no developer page exists any more (`/developers`, `/developers/doc` return 404); only an embeddable map tool.
- **Terms:** `fl511.com/privacy`: "users of the Service are granted non-exclusive, non-transferable limited license to access and use the Information for personal purposes only (and specifically excluding any commercial use)." The site also says "Some data contributed by Waze".
- **Recommendation:** don't use. Keep the county's weekly road list (already live); a data agreement with FDOT is an owner decision (D-M4b-3 left FDOT deferred).

### 14. Palm Beach County Commission agendas and news

- **Agendas:** `https://discover.pbc.gov/countycommissioners/Pages/Agenda.aspx` lists `http://www.pbcgov.com/pubInf/Agenda/{YYYYMMDD}/{YYYYMMDD}.pdf` (next: October 20, 2026). Planning and zoning agendas have their own pages. Meeting video is on `pbc.gov` players and YouTube.
- **Robots:** `discover.pbc.gov` disallows SharePoint system paths, `/Lists/`, `/SiteAssets/` and `/Search/`; the agenda page is allowed. `pbcgov.com` redirects to `pbc.gov`, whose robots.txt is `User-Agent: *` with no rules.
- **News releases:** the News Archive page renders a SharePoint "Newsroom" list by script; the list XML (`/_vti_bin/owssvr.dll`) answers 401, and item pages sit under `/Lists/` (disallowed). Not readable.
- **Terms:** none found (unverified). Public records.
- **Recommendation:** adopt now (allowed by robots) for agendas, with the `pdf-list` adapter: county decisions that touch Boca (roads, parks, annexation, budget). County news releases: subscribe a staff inbox to the county's email bulletins (decision (d) of 2026-10-16).

### 15. Police and fire releases

**15a. Boca Raton Police and Fire Rescue.**
- News Flash has separate categories: 17 "Police News Releases", 37 "Fire Rescue News", 5 "Police Information", 14 "Media Releases". The list page is `https://www.myboca.us/m/newsflash?cat=17` (`CivicAlerts.aspx?CID=17` redirects there). Each release is a short page whose body links a PDF at `/DocumentCenter/View/{id}`.
- **Gap (surprising):** our current `All-newsflash.xml` feed returned 13 items, none of them police releases, and asking for a category feed by guessed name returns the same default feed. The category feed names are listed only on `/RSS.aspx`, which robots.txt disallows. So Boca's official police releases are not reaching the pipeline today (unverified whether "All" includes them on other days).
- **Robots:** myboca.us disallows `/RSS.aspx`, `/Search`, `/CurrentEvents*`, `/map.asp*` and admin paths. `/m/newsflash`, `/CivicAlerts.aspx` and `/DocumentCenter/` are allowed.
- **Volume:** 55 police releases since December 2021, about one a month lately (latest September 22, 2026). Fire Rescue News has 2 items.
- **Sample:** `boca-police-releases.json`.
- **Recommendation:** adopt now (allowed by robots): extend the `civicplus` adapter to read a News Flash category list page and its linked PDF. Tier 3 by beat; these are official releases, which Rule 4 and §7 require for arrests.

**15b. PBSO.**
- WordPress REST: `https://www.pbso.org/wp-json/wp/v2/posts?per_page=5&_fields=id,date,link,title,categories`. Categories include "Boca Raton" (id 387), "District 1"–"20", "BUSTED", "Cold Cases".
- **Robots:** allows all but `/wp-admin/`, `/search`, `/login/` and similar; `/wp-json/` and `/feed/` are allowed. (`/feed/` answered 301.)
- **Freshness:** the "Boca Raton" tag is stale (latest 2023-03-15). Current releases (about weekly, latest 2026-10-13) carry county-wide categories only. PBSO covers unincorporated West Boca, not the city.
- **Sample:** `pbso-boca-raton-posts.json` (the stale tag).
- **Caution:** posts name suspects and sometimes victims. Tier 3; any named minor is Tier 4.
- **Recommendation:** adopt now (allowed by robots) as a county source, with the wrong-town check deciding which posts belong to Boca.

### 16. CourtListener (federal court filings, S.D. Fla.)

- **Robots:** `www.courtlistener.com/robots.txt` answers CloudFront 403 ("Request blocked") for our User-Agent and for curl's default. The Fetcher reads 403 as "no rules", but the CDN blocks us.
- **API:** `https://www.courtlistener.com/api/rest/v4/` answered 429 without a token. The docs (`/help/api/rest/`) say: "By default, authenticated users may make up to 5 requests per minute, 50 requests per hour, and 125 requests per day." and "Commercial agreements are also available."
- **Terms:** `/terms/` answered 403; not read.
- **Granularity:** case (S.D. Fla. dockets with party addresses only in the filings).
- **Caution:** lawsuits name private people and are accusatory: Tier 3. CourtListener is a third party mirroring PACER; PACER itself costs $0.10 a page.
- **Recommendation:** needs owner sign-up (free token; a commercial agreement is likely needed for a for-profit network).

### 17. Florida Department of Revenue NAL/SDF

- **Path:** `https://floridarevenue.com/property/dataportal/Pages/default.aspx` → folders `Tax Roll Data Files/NAL`, `SDF`, `NAP`, `NAV`; one zip per county and roll, for example `SDF/2026P/Broward Preliminary SDF 2026.zip`. The 2026 preliminary folder lists 19 counties; Palm Beach (60) is likely on the paged second page of `2026F` (not confirmed).
- **Robots:** for `*`, disallowed: `/dor/*`, `*/Lists/*`, `/Forms_library/20*` and seasonal tax-holiday paths. `/property/dataportal/Documents/` is allowed. (`/Documents/` is disallowed only for the SortSite crawler.)
- **Terms:** owner approved as a property-sales backfill (decision (c), 2026-10-16). No separate terms page was found.
- **Privacy:** NAL carries owners' names and mailing addresses: never store those columns. SDF has parcel, price, date, qualification code and deed book/page, with no names.
- **Cadence:** preliminary roll in July, final after the Value Adjustment Board (late in the year).
- **Recommendation:** adopt now (allowed by robots), SDF only, through the shared file cache. The county property appraiser feed stays the weekly source; DOR is the yearly backfill and the version for counties without an open feed.

---

## 3. What this adds for Boca, in order

1. **Police releases** (15a): wire the News Flash police category; real Tier 3 items about monthly.
2. **Development projects** (5a): proposed, approved and under-construction projects with case numbers.
3. **Nursing home and hospital ratings** (7) and **gas prices** (4): recurring explainers and Today-tile lines.
4. **County agendas** (14), **hurricane outlook** (12), **unemployment** (3), **federal awards** (1): network-wide, written once.
5. Waiting on the owner: Census key (2), DOL key (9), FLDOE endpoint call (6), CourtListener (16), `DOCUMENTED_APIS` entries for BLS, FEC and ECHO.
